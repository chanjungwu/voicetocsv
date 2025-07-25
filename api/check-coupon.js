import { google } from 'googleapis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 請求' });
    }

    try {
        const { coupon } = req.body;

        if (!coupon) {
            return res.status(400).json({ error: '請提供優惠碼' });
        }

        // 認證 Google API
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], // 唯讀即可
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.SHEET_ID;
        
        // 讀取「優惠碼紀錄表」的 A 欄
        const range = '優惠碼紀錄表!A:A'; 

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: '無法讀取優惠碼列表' });
        }

        // 將所有優惠碼轉換為一個 Set，方便快速查找
        const couponSet = new Set(rows.flat().map(c => c.trim().toUpperCase()));

        // 檢查使用者輸入的優惠碼是否存在
        if (couponSet.has(coupon.trim().toUpperCase())) {
            // 如果存在，回傳成功
            return res.status(200).json({ success: true, message: '優惠碼有效' });
        } else {
            // 如果不存在，回傳錯誤
            return res.status(404).json({ error: '無效的優惠碼' });
        }

    } catch (error) {
        console.error('Check Coupon API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤' });
    }
}