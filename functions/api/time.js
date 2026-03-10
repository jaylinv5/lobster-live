// 获取服务器时间接口
export async function onRequestGet(context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  return new Response(JSON.stringify({
    success: true,
    serverTime: new Date().toISOString()
  }), { headers, status: 200 });
}
