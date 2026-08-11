export default async function handler(req, res) {
  // CORS 처리 (크롬 확장 프로그램에서 요청을 허용하기 위함)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  const NOTION_API_KEY = process.env.NOTION_TOKEN || '';
  const DATABASE_ID = process.env.NOTION_SCHEDULE_DB_ID || '';
  
  if (!NOTION_API_KEY || !DATABASE_ID) {
    return res.status(500).json({ error: "환경변수(NOTION_API_KEY, DATABASE_ID)가 설정되지 않았습니다." });
  }
  
  // 오늘 날짜 (YYYY-MM-DD)
  const todayStr = new Date().toISOString().split("T")[0];
  
  try {
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: {
          and: [
            { property: "기간", date: { on_or_before: todayStr } },
            { property: "기간", date: { on_or_after: todayStr } }
          ]
        }
      })
    });
    
    const data = await notionRes.json();
    
    if (data.results && data.results.length > 0) {
      const page = data.results[0];
      
      // 노션 DB 속성에 맞게 데이터 추출
      const hostName = page.properties["호스트"]?.title[0]?.plain_text || "이름없음";
      const startDate = page.properties["기간"]?.date?.start;
      const endDate = page.properties["기간"]?.date?.end || startDate;
      
      return res.status(200).json({ hostName, startDate, endDate });
    }
    
    // 오늘 날짜에 해당하는 데이터가 없는 경우
    return res.status(200).json(null);
    
  } catch (error) {
    console.error("Notion API Error:", error);
    return res.status(500).json({ error: "Notion API 연동 중 오류 발생" });
  }
}