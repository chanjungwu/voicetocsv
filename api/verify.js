import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '僅允許 POST 請求' });
    }

    try {
        const { amount, date, time, account, email, coupon } = req.body;

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.SHEET_ID;
        
        // 讀取「匯款紀錄」
        const paymentRange = '工作表1!A:G'; // 讀取到 G 欄即可
        const paymentResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: paymentRange });
        const paymentRows = paymentResponse.data.values;
        if (!paymentRows || paymentRows.length === 0) {
            return res.status(500).json({ error: '無法讀取付款紀錄表' });
        }

        let matchRowIndex = -1;
        const targetTimeStr = `${date.replace(/-/g, '/')} ${time}`;

        for (let i = 1; i < paymentRows.length; i++) {
            const row = paymentRows[i];
            if (!row || row.length === 0) continue;

            const sheetTimeStr = row[0];   // A: 匯款時間
            const sheetAmount = row[1];  // B: 匯款金額
            const sheetStatus = row[6];    // G: 授權碼

            if (!sheetTimeStr || !sheetAmount) continue;

            const isTimeMatch = sheetTimeStr.startsWith(targetTimeStr);
            const isAmountMatch = parseInt(sheetAmount.trim(), 10) === parseInt(amount, 10);
            const isStatusAvailable = !sheetStatus || sheetStatus.trim() === '';

            if (isAmountMatch && isTimeMatch && isStatusAvailable) {
                matchRowIndex = i;
                break;
            }
        }

        if (matchRowIndex === -1) {
            return res.status(404).json({ error: '找不到匹配的付款紀錄。請確認金額和時間是否正確，或該筆紀錄已被使用。' });
        }

        // --- 成功匹配後，開始執行寫入操作 ---

        const activationCode = `VOICE-CSV-${uuidv4().split('-')[0].toUpperCase()}`;
        
        // 動作一：更新「匯款紀錄」工作表
        const updateRequests = [
            // 寫入 G 欄：授權碼
            { range: `工作表1!G${matchRowIndex + 1}`, values: [[activationCode]] },
            // 寫入 F 欄：Email
            { range: `工作表1!F${matchRowIndex + 1}`, values: [[email]] },
            // 寫入 D 欄：帳號後五碼
            { range: `工作表1!D${matchRowIndex + 1}`, values: [[account]] },
        ];
        
        // 如果有使用優惠碼，額外增加兩個寫入動作
        if (coupon) {
            // 寫入 E 欄：優惠碼
            updateRequests.push({ range: `工作表1!E${matchRowIndex + 1}`, values: [[coupon]] });
            
            // 動作二：更新「優惠碼紀錄表」的分潤
            await updateCommission(sheets, spreadsheetId, coupon, parseInt(amount, 10));
        }

        // 一次性執行所有對「匯款紀錄」的更新
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: updateRequests,
            },
        });

        return res.status(200).json({ activationCode });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: '伺服器內部錯誤，請聯繫管理員。' });
    }
}


// --- 輔助函式：專門用來更新分潤 ---
async function updateCommission(sheets, spreadsheetId, coupon, amount) {
    const commissionMap = { 45: 10, 255: 60, 485: 360 };
    const commissionToAdd = commissionMap[amount];

    if (!commissionToAdd) {
        console.log(`金額 ${amount} 沒有對應的分潤，跳過更新。`);
        return; // 如果金額不符，就不執行任何動作
    }

    // 1. 讀取整個「優惠碼紀錄表」
    const range = '優惠碼紀錄表!A:B';
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values;
    if (!rows) return;

    // 2. 找到優惠碼所在的行
    let couponRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].trim().toUpperCase() === coupon.trim().toUpperCase()) {
            couponRowIndex = i;
            break;
        }
    }

    if (couponRowIndex === -1) {
        console.log(`在優惠碼紀錄表中找不到優惠碼 ${coupon}，跳過更新。`);
        return; // 找不到對應的優惠碼
    }

    // 3. 計算新的累計金額
    const currentRow = rows[couponRowIndex];
    const currentCommission = parseInt(currentRow[1] || '0', 10); // B 欄：累計金額
    const newCommission = currentCommission + commissionToAdd;

    // 4. 更新該儲存格
    const updateRange = `優惠碼紀錄表!B${couponRowIndex + 1}`;
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[newCommission]] },
    });
    
    console.log(`成功為優惠碼 ${coupon} 累計分潤 ${commissionToAdd} 元。`);
}