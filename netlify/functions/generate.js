exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API 키가 설정되지 않았습니다.' }) };
  }

  try {
    const { pdf64, qtype, qdiff, qcount, existing } = JSON.parse(event.body);

    const dmap = { easy: '쉬운', medium: '중간 난이도의', hard: '어려운' };
    const tmap = {
      mixed: '객관식 4지선다, OX 문제, 단답형을 고루 섞어서',
      mc: '모두 객관식 4지선다로',
      ox: '모두 OX 문제로',
      sa: '모두 단답형으로'
    };

    const avoidStr = existing ? `\n이미 출제된 문제와 겹치지 않게 해주세요:\n${existing}` : '';

    const prompt = `이 PDF 문서를 꼼꼼히 분석해서 ${dmap[qdiff] || '중간 난이도의'} 시험문제 ${qcount}개를 만들어주세요.
${tmap[qtype] || tmap.mixed} 출제해주세요.${avoidStr}

반드시 아래 JSON 형식만 반환하세요 (마크다운 없이 순수 JSON):
{"questions":[{"id":1,"type":"mc","question":"문제","options":["①보기1","②보기2","③보기3","④보기4"],"answer":"①보기1","explanation":"해설"},{"id":2,"type":"ox","question":"문제","options":["O","X"],"answer":"O","explanation":"해설"},{"id":3,"type":"sa","question":"___ 에 들어갈 말은?","options":[],"answer":"키워드","explanation":"해설"}]}

규칙: type은 mc/ox/sa 중 하나, mc의 answer는 options 중 하나와 정확히 일치, ox의 answer는 "O" 또는 "X", sa의 answer는 짧은 키워드, 모든 문제는 PDF 내용에서만 출제`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: 'application/pdf', data: pdf64 } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Gemini API 오류 ' + response.status);
    }

    const data = await response.json();
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    raw = raw.replace(/```json|```/g, '').trim();
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('응답 파싱 오류');
    const parsed = JSON.parse(raw.slice(start, end + 1));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
