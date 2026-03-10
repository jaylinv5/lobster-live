// Cloudflare Pages Function - 获取实时直播数据接口
export async function onRequestGet(context) {
  const { request, env } = context;
  
  // 设置CORS头
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  };

  // 处理OPTIONS预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  try {
    // 获取查询参数
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit')) || 50;
    const since = url.searchParams.get('since');

    // 获取实时列表
    const liveList = await env.LOBSTER_KV.get('live:list', 'json') || [];
    
    // 补充完整的龙虾信息
    const fullList = [];
    for (const item of liveList) {
      const fullData = await env.LOBSTER_KV.get(`lobster:${item.id}`, 'json');
      if (fullData) {
        fullList.push({
          ...item,
          bio: fullData.bio || ''
        });
      } else {
        fullList.push(item);
      }
    }
    
    // 如果有since参数，只返回之后的新数据
    let filteredList = fullList;
    if (since) {
      filteredList = fullList.filter(item => new Date(item.joinTime) > new Date(since));
    }

    // 限制返回数量
    if (filteredList.length > limit) {
      filteredList = filteredList.slice(0, limit);
    }

    // 获取统计数据
    const stats = await env.LOBSTER_KV.get('stats', 'json') || {
      total: 0,
      today: 0,
      totalCredits: 0,
      lastUpdate: new Date().toISOString().split('T')[0]
    };

    // 获取技能统计
    const skillStats = {};
    fullList.forEach(item => {
      skillStats[item.skill] = (skillStats[item.skill] || 0) + 1;
    });

    // 返回数据
    return new Response(JSON.stringify({
      success: true,
      data: {
        list: filteredList,
        stats: {
          total: stats.total,
          online: fullList.length,
          today: stats.today,
          totalCredits: stats.totalCredits
        },
        skillStats,
        timestamp: new Date().toISOString()
      }
    }), { headers, status: 200 });

  } catch (error) {
    console.error('获取数据错误:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '服务器错误，请稍后重试',
      data: {
        list: [],
        stats: { total: 0, online: 0, today: 0, totalCredits: 0 },
        skillStats: {},
        timestamp: new Date().toISOString()
      }
    }), { headers, status: 500 });
  }
}
