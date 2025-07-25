import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 請求' });
    }

    try {
        const { amount, date, time, account, email } = req.body;

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.SHEET_ID;
        const range = '工作表1!A:I'; // 讀取 A 到 I 欄的所有資料

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(500).json({ error: '無法讀取付款紀錄表' });
        }

        let matchRowIndex = -1;
        const userInputDate = new Date(`${date}T${time}:00+08:00`);
        userInputDate.setSeconds(0, 0);

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue; // 跳過空行

            // 【最終修正】根據您的表格結構，使用正確的欄位索引
            const sheetTimeStr = row[0];   // 欄位 A: 匯款時間
            const sheetAmount = row[1];  // 欄位 B: 匯款金額
            const sheetAccount = row[3]; // 欄位 D: 匯款帳號後5碼
            const sheetStatus = row[6];    // 欄位 G: 授權碼

            if (!sheetTimeStr || !sheetAmount) continue;

            const sheetDate = new Date(`${sheetTimeStr.replace(/\//g, '-')}:00+08:00`.replace(' ', 'T'));
            sheetDate.setSeconds(0, 0);

            const timeDifference = Math.abs(userInputDate - sheetDate) / (1000 * 60);

            const isAmountMatch = parseInt(sheetAmount.trim(), 10) === parseInt(amount, 10);
            const isTimeMatch = timeDifference < 1;
            const isStatusAvailable = !sheetStatus || sheetStatus.trim() === ''; // 授權碼欄位為空
            
            // 增加帳號後五碼作為額外驗證
            const isAccountMatch = sheetAccount && sheetAccount.trim() === account;

            if (isAmountMatch && isTimeMatch && isStatusAvailable && isAccountMatch) {
                matchRowIndex = i;
                break;
            }
        }

        if (matchRowIndex === -1) {
            return res.status(404).json({ error: '找不到匹配的付款紀錄。請確認金額和時間是否正確，或該筆紀錄已被使用。' });
        }

        const activationCode = `VOICE-CSV-${uuidv4().split('-')[0].toUpperCase()}`;
        
        // 【最終修正】將啟用碼寫入到正確的 G 欄
        const updateRange = `工作表1!G${matchRowIndex + 1}`; 
        const updateValues = [[activationCode]];
        
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: updateValues },
        });

        // (可選) 您也可以將 Email 更新到 F 欄
        const emailUpdateRange = `工作表1!F${matchRowIndex + 1}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: emailUpdateRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[email]] },
        });
        
        return res.status(200).json({ activationCode });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤，請聯繫管理員。' });
    }
}