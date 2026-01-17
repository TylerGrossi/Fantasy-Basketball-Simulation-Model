// ESPN Proxy API - forwards requests with proper authentication
// This helps avoid CORS issues and properly formats the cookie header

export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      const { url, espn_s2, swid } = req.body;
  
      if (!url || !espn_s2 || !swid) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
  
      // Make request to ESPN with proper headers
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Cookie': `SWID=${swid}; espn_s2=${espn_s2}`,
          'X-Fantasy-Source': 'kona',
          'X-Fantasy-Platform': 'kona-PROD-1dc40132dc2070ef47881dc95b633e62cebc9913',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://fantasy.espn.com',
          'Referer': 'https://fantasy.espn.com/',
        },
      });
  
      if (!response.ok) {
        console.error(`ESPN API error: ${response.status} ${response.statusText}`);
        return res.status(response.status).json({ 
          error: `ESPN returned an HTTP ${response.status}` 
        });
      }
  
      const data = await response.json();
      return res.status(200).json(data);
  
    } catch (error) {
      console.error('Proxy error:', error);
      return res.status(500).json({ error: error.message || 'Proxy request failed' });
    }
  }