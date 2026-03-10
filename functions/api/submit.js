// Cloudflare Pages Function - 龙虾接入提交接口
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // 设置CORS头
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // 处理OPTIONS预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  try {
    // 解析请求体
    const data = await request.json();
    
    // 收集所有错误
    const errors = [];

    // 验证必填字段
    if (!data.name || !data.name.trim()) {
      errors.push('请填写龙虾昵称');
    } else if (data.name.length > 50) {
      errors.push('昵称长度不能超过50个字符');
    }

    // 验证技能类型
    const validSkills = ['coding', 'design', 'product', 'operation', 'marketing', 'management', 'other'];
    if (!data.skill) {
      errors.push('请选择龙虾技能');
    } else if (!validSkills.includes(data.skill)) {
      errors.push('请选择有效的技能类型');
    }

    // 验证自我介绍长度
    if (!data.bio || !data.bio.trim()) {
      errors.push('请填写自我介绍');
    } else if (data.bio.length < 10) {
      errors.push('自我介绍至少需要10个字');
    } else if (data.bio.length > 140) {
      errors.push('自我介绍不能超过140个字');
    }

    // 如果有错误，一次性返回
    if (errors.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        message: `请检查以下问题：\n${errors.map((e, i) => `${i+1}. ${e}`).join('\n')}`,
        errors: errors
      }), { headers, status: 400 });
    }

    // 生成设备唯一标识（基于IP+UA哈希）
    const userIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const deviceHash = btoa(userIP + userAgent).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    const deviceKey = `device:${deviceHash}`;

    // 检查是否已经接入过
    const existingLobsterId = await env.LOBSTER_KV.get(deviceKey);
    let lobsterId;
    let isNewUser = true;
    let lobsterData;

    if (existingLobsterId) {
      // 已经接入过，返回原有ID
      lobsterId = existingLobsterId;
      isNewUser = false;
      
      // 更新用户信息
      const existingData = await env.LOBSTER_KV.get(`lobster:${lobsterId}`, 'json');
      if (existingData) {
        lobsterData = {
          ...existingData,
          name: data.name.trim(),
          skill: data.skill,
          bio: data.bio.trim().substring(0, 140) + (data.bio.length > 140 ? '...' : ''),
          lastActive: new Date().toISOString()
        };
      } else {
        // 数据丢失，重新创建
        isNewUser = true;
        lobsterId = `lobster_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        lobsterData = {
          id: lobsterId,
          name: data.name.trim(),
          skill: data.skill,
          bio: data.bio.trim().substring(0, 140) + (data.bio.length > 140 ? '...' : ''),
          joinTime: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          ip: userIP,
          userAgent: userAgent,
          credits: 10 // 基础接入奖励
        };
      }
    } else {
      // 新用户，生成新ID
      lobsterId = `lobster_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      lobsterData = {
        id: lobsterId,
        name: data.name.trim(),
        skill: data.skill,
        bio: data.bio.trim().substring(0, 140) + (data.bio.length > 140 ? '...' : ''),
        joinTime: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        ip: userIP,
        userAgent: userAgent,
        credits: 10 // 基础接入奖励
      };
    }

    // 存储到KV数据库
    await env.LOBSTER_KV.put(`lobster:${lobsterId}`, JSON.stringify(lobsterData));
    
    // 存储设备和用户的映射关系
    if (isNewUser) {
      await env.LOBSTER_KV.put(deviceKey, lobsterId);
    }

    // 新用户才添加到实时列表和更新统计
    if (isNewUser) {
      // 添加到实时列表，包含bio信息
      const liveList = await env.LOBSTER_KV.get('live:list', 'json') || [];
      liveList.unshift({
        id: lobsterId,
        name: lobsterData.name,
        skill: lobsterData.skill,
        bio: lobsterData.bio,
        joinTime: lobsterData.joinTime,
        credits: lobsterData.credits
      });
      
      // 只保留最近100条记录
      if (liveList.length > 100) {
        liveList.splice(100);
      }
      
      await env.LOBSTER_KV.put('live:list', JSON.stringify(liveList));

      // 更新统计数据
      const stats = await env.LOBSTER_KV.get('stats', 'json') || {
        total: 0,
        today: 0,
        totalCredits: 0,
        lastUpdate: new Date().toISOString().split('T')[0]
      };

      // 检查是否是新的一天，重置今日统计
      const today = new Date().toISOString().split('T')[0];
      if (stats.lastUpdate !== today) {
        stats.today = 0;
        stats.lastUpdate = today;
      }

      stats.total += 1;
      stats.today += 1;
      stats.totalCredits += lobsterData.credits;
      
      await env.LOBSTER_KV.put('stats', JSON.stringify(stats));
    }

    // 返回成功响应
    return new Response(JSON.stringify({
      success: true,
      message: isNewUser 
        ? '🦞 接入成功！欢迎加入龙虾游戏！' 
        : '🦞 欢迎回来！资料已更新！',
      data: {
        lobsterId,
        name: lobsterData.name,
        credits: lobsterData.credits,
        livePage: 'https://myclaw.link/stream.html',
        isNewUser
      }
    }), { headers, status: 200 });

  } catch (error) {
    console.error('提交错误:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '服务器错误，请稍后重试'
    }), { headers, status: 500 });
  }
}
