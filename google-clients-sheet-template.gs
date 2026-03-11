/**
 * Google Apps Script template for Clients sheet in Radar NR.
 * Add this to your existing Apps Script project where doPost/doGet already dispatch actions.
 */

const CLIENTS_SHEET = 'Clients';

function ensureClientsSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CLIENTS_SHEET);
  if (!sh) sh = ss.insertSheet(CLIENTS_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['id', 'name', 'company', 'phone', 'proDiscount', 'createdAt', 'updatedAt']);
  }
  return sh;
}

function getClients_() {
  const sh = ensureClientsSheet();
  const rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, name, company, phone, proDiscount] = rows[i];
    if (!name) continue;
    out.push({
      id: String(id || ''),
      name: String(name || '').trim(),
      company: String(company || '').trim(),
      phone: String(phone || '').trim(),
      proDiscount: Number(proDiscount || 0) || 0,
    });
  }
  return out;
}

function addClient_(client) {
  const sh = ensureClientsSheet();
  const id = client.id || ('C_' + new Date().getTime());
  const now = new Date().toISOString();
  sh.appendRow([
    id,
    String(client.name || '').trim(),
    String(client.company || '').trim(),
    String(client.phone || '').trim(),
    Number(client.proDiscount || 0) || 0,
    now,
    now,
  ]);
  return { success: true, id };
}

function updateClient_(client) {
  const sh = ensureClientsSheet();
  const id = String(client.id || '').trim();
  if (!id) return { success: false, error: 'id required' };
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === id) {
      sh.getRange(i + 1, 2).setValue(String(client.name || '').trim());
      sh.getRange(i + 1, 3).setValue(String(client.company || '').trim());
      sh.getRange(i + 1, 4).setValue(String(client.phone || '').trim());
      sh.getRange(i + 1, 5).setValue(Number(client.proDiscount || 0) || 0);
      sh.getRange(i + 1, 7).setValue(new Date().toISOString());
      return { success: true };
    }
  }
  return { success: false, error: 'not found' };
}

function deleteClient_(id) {
  const sh = ensureClientsSheet();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === String(id || '').trim()) {
      sh.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'not found' };
}

/**
 * Add into your dispatcher:
 * case 'getClients': return { success: true, clients: getClients_() }
 * case 'addClient': return addClient_(payload.client || {})
 * case 'updateClient': return updateClient_(payload.client || {})
 * case 'deleteClient': return deleteClient_(payload.id)
 */
