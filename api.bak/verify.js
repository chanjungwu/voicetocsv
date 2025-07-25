import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid'; // 用於生成唯一碼

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 請求' });
    }

    try {
        const { amount, date, time, account, email } = req.body;

        // 1. 認證 Google API
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.SHEET_ID;

        // 2. 讀取 Google Sheet 的所有資料
        const range = '工作表1!A:D'; // 假設您的工作表名稱是 "工作表1"
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: '無法讀取付款紀錄表' });
        }

        // 3. 尋找匹配的紀錄
        let matchRowIndex = -1;
        const userInputDate = new Date(`${date}T${time}:00`); // 客戶輸入的時間

        for (let i = 1; i < rows.length; i++) { // 從第2行開始 (跳過標題)
            const row = rows[i];
            const [sheetTime, sheetAccount, sheetAmount, sheetStatus] = row;
            
            // 檢查條件
            if (!sheetTime || !sheetAmount) continue;

            const sheetDate = new Date(sheetTime.replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3'));
            const timeDifference = Math.abs(userInputDate - sheetDate) / (1000 * 60); // 分鐘差

            const isAmountMatch = parseInt(sheetAmount, 10) === parseInt(amount, 10);
            const isTimeMatch = timeDifference <= 5; // 允許5分鐘內的誤差
            const isStatusAvailable = !sheetStatus || sheetStatus.trim() === '尚未使用';

            if (isAmountMatch && isTimeMatch && isStatusAvailable) {
                matchRowIndex = i;
                break;
            }
        }

        if (matchRowIndex === -1) {
            return res.status(404).json({ error: '找不到匹配的付款紀錄。請確認金額和時間是否正確，或該筆紀錄已被使用。' });
        }

        // 4. 生成啟用碼並更新表格
        const activationCode = `VOICE-CSV-${uuidv4().split('-')[0].toUpperCase()}`;
        const updateRange = `工作表1!D${matchRowIndex + 1}`;
        const updateValues = [[`已啟用 - ${activationCode} | Email: ${email} | 帳號: ${account}`]];
        
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: updateValues,
            },
        });

        // 5. 回傳成功訊息
        // (這裡可以加入寄送 Email 的程式碼)
        
        return res.status(200).json({ activationCode });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤，請聯繫管理員。' });
    }
}