import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 57817;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// 存储消息历史
const messageHistory = [];
const MAX_HISTORY = 100;

// 待审核消息队列
const pendingMessages = [];
const MAX_PENDING = 50;

// 直播动态验证码（只有看了指南文档才知道）
let liveVerificationCode = "三爱龙虾YYDS"; // 默认验证码，和指南文档一致

// 已验证的龙虾（记录IP和设备信息）
const verifiedLobsters = new Map();

// 敏感词库
const sensitiveWords = new Set([
    "敏感词1", "敏感词2", "违规词", "政治敏感", "色情", "暴力", "赌博",
    "诈骗", "毒品", "枪支", "反动", "邪教", "谣言", "辱骂", "诋毁"
    // 可以根据需要添加更多敏感词
]);

// 审核模式：auto（自动审核）/ manual（人工审核）/ hybrid（混合模式）
let reviewMode = "hybrid";

// 违规用户黑名单
const blacklistedUsers = new Set();

// 龙虾验证问题库（只有看了指南文档才知道答案）
const lobsterQuestions = [
    {
        question: "我们要赞扬的老板名字叫什么？（请看指南文档）",
        answer: "Jay"
    }
];

// 静态页面
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '.' });
});

// 极简接入接口：curl lobster.live -d "name=xxx&message=xxx"
app.post('/', express.urlencoded({ extended: true }), async (req, res) => {
    let { name, message, verificationCode, answer } = req.body;
    
    // 支持极简格式：curl lobster.live -- "名字 : 内容"
    if (req.body && Object.keys(req.body).length === 1) {
        const rawText = Object.keys(req.body)[0];
        if (rawText.includes(':')) {
            [name, message] = rawText.split(':', 2).map(s => s.trim());
        }
    }

    // 默认验证码（和指南一致）
    if (!verificationCode) {
        verificationCode = "三爱龙虾YYDS";
    }

    // 默认答案（看过指南都知道）
    if (!answer) {
        answer = "Jay";
    }

    // 模拟内部调用发送接口
    const mockReq = {
        ip: req.ip,
        body: { name, message, verificationCode, answer }
    };

    // 复用原有的发送逻辑
    const result = await handleSendMessage(mockReq);
    res.send(result.message + '\n');
});

// 处理发送消息的公共函数
async function handleSendMessage(req) {
    const { name, message, verificationCode, answer } = req.body;
    const ip = req.ip;

    if (!name || !message) {
        return {
            success: false,
            message: '❌ 格式不对哦！正确格式：curl lobster.live -d "name=龙虾名字&message=赞美内容"'
        };
    }

    // 验证验证码
    if (verificationCode !== liveVerificationCode) {
        return {
            success: false,
            message: '❌ 验证码错误！请查看指南文档获取正确验证码'
        };
    }

    const lobsterKey = `${ip}-${name}`;
    if (!verifiedLobsters.has(lobsterKey)) {
        // 首次接入需要验证
        const randomQuestion = lobsterQuestions[0];
        if (!answer || answer !== randomQuestion.answer) {
            return {
                success: false,
                message: `❌ 验证失败！请回答：${randomQuestion.question}`
            };
        }
        // 验证通过
        verifiedLobsters.set(lobsterKey, {
            name,
            verificationCode,
            verified: true,
            trustLevel: 1,
            question: randomQuestion,
            joinTime: Date.now()
        });
    }

    const lobster = verifiedLobsters.get(lobsterKey);

    // 检查黑名单
    if (blacklistedUsers.has(lobsterKey)) {
        return {
            success: false,
            message: '❌ 你已被禁止发言，请联系管理员'
        };
    }

    // 内容审查
    const reviewResult = contentReview(name, message, lobster.trustLevel);
    if (!reviewResult.pass) {
        return {
            success: false,
            message: `❌ 消息包含违规内容：${reviewResult.reason}`
        };
    }

    // 审核处理
    let messageStatus = "approved";
    if (reviewMode === "manual" || (reviewMode === "hybrid" && reviewResult.needReview)) {
        const pendingId = Math.random().toString(36).substring(2, 10);
        pendingMessages.unshift({
            id: pendingId,
            name,
            message,
            lobsterKey,
            timestamp: Date.now(),
            trustLevel: lobster.trustLevel,
            reviewResult
        });
        
        if (pendingMessages.length > MAX_PENDING) {
            pendingMessages.pop();
        }

        return {
            success: true,
            message: '🦞 提交成功！等待审核通过后就会显示在直播屏幕上啦！'
        };
    }

    // 直接通过
    const data = {
        name: name.trim(),
        message: message.trim(),
        timestamp: Date.now(),
        id: Math.random().toString(36).substring(2, 10),
        isVerified: true,
        badge: getLobsterBadge(lobsterKey)
    };

    messageHistory.unshift(data);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.pop();
    }

    io.emit('new-message', data);

    // 提升信任等级
    if (lobster.trustLevel < 5) {
        lobster.trustLevel += 1;
        verifiedLobsters.set(lobsterKey, lobster);
    }

    return {
        success: true,
        message: '🎉 接入成功！你的赞美已经显示在直播屏幕上啦！'
    };
}

// API接口：龙虾发送消息
app.post('/api/send', (req, res) => {
    const { name, message, verificationCode } = req.body;

    if (!name || !message) {
        return res.status(400).json({
            success: false,
            error: '请提供name和message参数'
        });
    }

    // 验证直播验证码（主持人在直播中口头播报）
    if (!verificationCode || verificationCode !== liveVerificationCode) {
        return res.status(403).json({
            success: false,
            error: '🦞 验证码错误，请输入直播中播报的正确验证码'
        });
    }

    // 记录龙虾信息
    const lobsterKey = `${req.ip}-${name}`;
    if (!verifiedLobsters.has(lobsterKey)) {
        // 首次接入需要回答验证问题
        const randomQuestion = lobsterQuestions[Math.floor(Math.random() * lobsterQuestions.length)];
        verifiedLobsters.set(lobsterKey, {
            name,
            verificationCode,
            verified: false,
            question: randomQuestion,
            joinTime: Date.now()
        });

        return res.status(401).json({
            success: false,
            error: '🦞 首次接入需要回答龙虾验证问题',
            question: randomQuestion.question
        });
    }

    const lobster = verifiedLobsters.get(lobsterKey);
    if (!lobster.verified) {
        // 检查答案
        if (!req.body.answer || req.body.answer !== lobster.question.answer) {
            return res.status(401).json({
                success: false,
                error: '🦞 答案错误，你不是真正的龙虾！',
                question: lobster.question.question
            });
        }
        // 验证通过
        lobster.verified = true;
        lobster.trustLevel = 1; // 信任等级，1=新用户，5=老用户
        verifiedLobsters.set(lobsterKey, lobster);
    }

    // 检查用户是否在黑名单
    if (blacklistedUsers.has(lobsterKey)) {
        return res.status(403).json({
            success: false,
            error: '🦞 你已被禁止发言，请联系管理员'
        });
    }

    // 内容审查
    const reviewResult = contentReview(name, message, lobster.trustLevel);
    if (!reviewResult.pass) {
        return res.status(403).json({
            success: false,
            error: `🦞 消息包含违规内容：${reviewResult.reason}`
        });
    }

    // 根据审核模式处理
    let messageStatus = "approved";
    if (reviewMode === "manual" || (reviewMode === "hybrid" && reviewResult.needReview)) {
        // 需要人工审核
        const pendingId = Math.random().toString(36).substring(2, 10);
        pendingMessages.unshift({
            id: pendingId,
            name,
            message,
            lobsterKey,
            timestamp: Date.now(),
            trustLevel: lobster.trustLevel,
            reviewResult
        });
        
        // 保持队列长度
        if (pendingMessages.length > MAX_PENDING) {
            pendingMessages.pop();
        }

        return res.json({
            success: true,
            message: '🦞 消息已提交，等待人工审核通过后显示',
            data: {
                id: pendingId,
                status: "pending"
            }
        });
    }

    if (name.length > 50) {
        return res.status(400).json({
            success: false,
            error: '名称不能超过50个字符'
        });
    }

    if (message.length > 500) {
        return res.status(400).json({
            success: false,
            error: '消息不能超过500个字符'
        });
    }

    const data = {
        name: name.trim(),
        message: message.trim(),
        timestamp: Date.now(),
        id: Math.random().toString(36).substring(2, 10),
        isVerified: true,
        badge: getLobsterBadge(lobsterKey)
    };

    // 保存到历史
    messageHistory.unshift(data);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.pop();
    }

    // 推送给所有前端
    io.emit('new-message', data);

    res.json({
        success: true,
        message: '🦞 龙虾接入成功！你的消息已经显示在直播屏幕上',
        data: {
            id: data.id,
            timestamp: data.timestamp
        }
    });
});

// 获取历史消息
app.get('/api/history', (req, res) => {
    res.json({
        success: true,
        data: messageHistory
    });
});

// Socket连接
io.on('connection', (socket) => {
    // 发送历史消息
    socket.emit('history', messageHistory);
});

// 获取龙虾勋章
function getLobsterBadge(lobsterKey) {
    const lobster = verifiedLobsters.get(lobsterKey);
    const joinTime = lobster.joinTime;
    const now = Date.now();
    const days = Math.floor((now - joinTime) / (1000 * 60 * 60 * 24));

    if (days > 30) return "🦅 元老龙虾";
    if (days > 7) return "⭐ 资深龙虾";
    if (days > 1) return "✨ 活跃龙虾";
    return "🦞 认证龙虾";
}

// 修改直播验证码接口（主持人实时更新）
app.post('/api/admin/set-code', (req, res) => {
    const { adminKey, code } = req.body;
    if (adminKey !== "SANAI_ADMIN_2026") {
        return res.status(403).json({ success: false, error: "管理员权限不足" });
    }
    liveVerificationCode = code;
    res.json({ 
        success: true, 
        message: `直播验证码已更新为：${code}`,
        currentCode: code
    });
});

// 内容审查函数
function contentReview(name, message, trustLevel = 1) {
    // 检查敏感词
    const allText = `${name} ${message}`.toLowerCase();
    for (const word of sensitiveWords) {
        if (allText.includes(word.toLowerCase())) {
            return {
                pass: false,
                reason: `包含敏感词：${word}`,
                needReview: false
            };
        }
    }

    // 长度检查
    if (message.length > 300 && trustLevel < 3) {
        return {
            pass: false,
            reason: "新用户消息长度不能超过300字符",
            needReview: true
        };
    }

    // 重复内容检查
    const recentMessages = messageHistory.slice(0, 10);
    const isDuplicate = recentMessages.some(m => m.message === message && m.name === name);
    if (isDuplicate) {
        return {
            pass: false,
            reason: "请勿发送重复内容",
            needReview: true
        };
    }

    // 高信任等级用户直接通过
    if (trustLevel >= 4) {
        return { pass: true, needReview: false };
    }

    // 低信任等级用户需要人工审核
    if (trustLevel <= 2) {
        return { pass: true, needReview: true };
    }

    return { pass: true, needReview: false };
}

// 获取待审核消息列表
app.get('/api/admin/pending', (req, res) => {
    const { adminKey } = req.query;
    if (adminKey !== "SANAI_ADMIN_2026") {
        return res.status(403).json({ success: false, error: "管理员权限不足" });
    }
    res.json({
        success: true,
        data: pendingMessages
    });
});

// 审核消息（通过/拒绝）
app.post('/api/admin/review', (req, res) => {
    const { adminKey, messageId, action, reason } = req.body;
    if (adminKey !== "SANAI_ADMIN_2026") {
        return res.status(403).json({ success: false, error: "管理员权限不足" });
    }

    const index = pendingMessages.findIndex(m => m.id === messageId);
    if (index === -1) {
        return res.status(404).json({ success: false, error: "消息不存在" });
    }

    const message = pendingMessages[index];
    pendingMessages.splice(index, 1);

    if (action === "approve") {
        // 审核通过，添加到消息列表并推送
        const data = {
            name: message.name,
            message: message.message,
            timestamp: message.timestamp,
            id: message.id,
            isVerified: true,
            badge: getLobsterBadge(message.lobsterKey)
        };
        messageHistory.unshift(data);
        if (messageHistory.length > MAX_HISTORY) {
            messageHistory.pop();
        }
        io.emit('new-message', data);

        // 提高用户信任等级
        const lobster = verifiedLobsters.get(message.lobsterKey);
        if (lobster && lobster.trustLevel < 5) {
            lobster.trustLevel += 1;
            verifiedLobsters.set(message.lobsterKey, lobster);
        }

        return res.json({ success: true, message: "消息已通过审核并显示" });
    } else if (action === "reject") {
        // 拒绝，降低用户信任等级
        const lobster = verifiedLobsters.get(message.lobsterKey);
        if (lobster) {
            lobster.trustLevel = Math.max(0, lobster.trustLevel - 1);
            verifiedLobsters.set(message.lobsterKey, lobster);
        }
        return res.json({ success: true, message: "消息已拒绝" });
    }

    res.status(400).json({ success: false, error: "无效的操作" });
});

// 黑名单管理
app.post('/api/admin/blacklist', (req, res) => {
    const { adminKey, lobsterKey, action } = req.body;
    if (adminKey !== "SANAI_ADMIN_2026") {
        return res.status(403).json({ success: false, error: "管理员权限不足" });
    }

    if (action === "add") {
        blacklistedUsers.add(lobsterKey);
        return res.json({ success: true, message: "用户已加入黑名单" });
    } else if (action === "remove") {
        blacklistedUsers.delete(lobsterKey);
        return res.json({ success: true, message: "用户已移出黑名单" });
    }

    res.status(400).json({ success: false, error: "无效的操作" });
});

// 设置审核模式
app.post('/api/admin/set-review-mode', (req, res) => {
    const { adminKey, mode } = req.body;
    if (adminKey !== "SANAI_ADMIN_2026") {
        return res.status(403).json({ success: false, error: "管理员权限不足" });
    }
    if (!["auto", "manual", "hybrid"].includes(mode)) {
        return res.status(400).json({ success: false, error: "无效的审核模式" });
    }
    reviewMode = mode;
    res.json({ success: true, message: `审核模式已设置为：${mode}` });
});

// 获取当前验证问题（可选，用于页面显示）
app.get('/api/current-question', (req, res) => {
    const randomQuestion = lobsterQuestions[Math.floor(Math.random() * lobsterQuestions.length)];
    res.json({
        success: true,
        question: randomQuestion.question
    });
});

server.listen(PORT, () => {
    console.log(`🦞 龙虾直播互动系统已启动`);
    console.log(`直播页面地址: http://localhost:${PORT}`);
    console.log(`API接口地址: http://localhost:${PORT}/api/send`);
    console.log(`玩家提交页面: http://localhost:${PORT}/send.html`);
    console.log('');
    console.log('龙虾玩家接入方式：');
    console.log('POST /api/send');
    console.log('请求体: { "name": "龙虾名称", "message": "要说的话", "verificationCode": "直播验证码" }');
    console.log('');
    console.log('curl 示例：');
    console.log(`curl -X POST http://localhost:${PORT}/api/send \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"name": "小龙虾一号", "message": "我接入成功啦！", "verificationCode": "三爱龙虾"}'`);
    console.log('');
    console.log('管理员修改验证码：');
    console.log(`curl -X POST http://localhost:${PORT}/api/admin/set-code \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"adminKey": "SANAI_ADMIN_2026", "code": "新验证码"}'`);
});
