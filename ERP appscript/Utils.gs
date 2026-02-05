/**
 * Utility Functions
 * Helper functions for UUID generation, formatting, and common operations
 */

// ============================================
// UUID GENERATION
// ============================================

function generateUUID() {
  return Utilities.getUuid();
}

// ============================================
// DATE FORMATTING
// ============================================

function formatDate(date, format) {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  switch(format) {
    case 'DD.MM.YYYY':
      return `${day}.${month}.${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    default:
      return `${day}.${month}.${year}`;
  }
}

function parseDate(dateString) {
  if (!dateString) return null;
  
  // Handle DD.MM.YYYY format
  if (dateString.includes('.')) {
    const parts = dateString.split('.');
    if (parts.length === 3) {
      return new Date(parts[2], parts[1] - 1, parts[0]);
    }
  }
  
  return new Date(dateString);
}

// ============================================
// CURRENCY FORMATTING
// ============================================

function formatCurrency(amount, currency) {
  if (amount === null || amount === undefined || isNaN(amount)) return '0.00 KM';
  
  const num = parseFloat(amount);
  const formatted = num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  return currency ? `${formatted} ${currency}` : `${formatted} KM`;
}

function parseCurrency(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  return parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
}

// ============================================
// NUMBER FORMATTING
// ============================================

function formatNumber(num, decimals) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  
  decimals = decimals || 0;
  return parseFloat(num).toFixed(decimals);
}

// ============================================
// OFFER NUMBER GENERATION
// ============================================

function generateOfferNumber() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
  const lastRow = sheet.getLastRow();
  
  const year = new Date().getFullYear();
  let nextNum = 1;
  
  if (lastRow > 1) {
    const existingNumbers = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    const thisYearNumbers = existingNumbers
      .map(row => row[0])
      .filter(num => num && num.includes(String(year)))
      .map(num => parseInt(num.split('-').pop()) || 0);
    
    if (thisYearNumbers.length > 0) {
      nextNum = Math.max(...thisYearNumbers) + 1;
    }
  }
  
  return `PON-${year}-${String(nextNum).padStart(3, '0')}`;
}

function generateOrderNumber() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  const lastRow = sheet.getLastRow();
  
  const year = new Date().getFullYear();
  let nextNum = 1;
  
  if (lastRow > 1) {
    const existingNumbers = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    const thisYearNumbers = existingNumbers
      .map(row => row[0])
      .filter(num => num && num.includes(String(year)))
      .map(num => parseInt(num.split('-').pop()) || 0);
    
    if (thisYearNumbers.length > 0) {
      nextNum = Math.max(...thisYearNumbers) + 1;
    }
  }
  
  return `NAR-${year}-${String(nextNum).padStart(3, '0')}`;
}

// ============================================
// ARRAY/OBJECT HELPERS
// ============================================

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, i) => {
    obj[header] = row[i] !== undefined ? row[i] : '';
  });
  return obj;
}

function objectToRow(headers, obj) {
  return headers.map(header => obj[header] !== undefined ? obj[header] : '');
}

function findRowByValue(sheet, columnIndex, value) {
  if (sheet.getLastRow() <= 1) return -1;
  
  const data = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1, 1).getValues();
  const searchValue = String(value);
  
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === searchValue) {
      return i + 2; // +2 for header row and 0-indexing
    }
  }
  
  return -1;
}

function getSheetData(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  return data.slice(1).map(row => rowToObject(headers, row));
}

// ============================================
// VALIDATION HELPERS
// ============================================

function validateRequired(obj, fields) {
  const missing = [];
  
  fields.forEach(field => {
    if (!obj[field] || (typeof obj[field] === 'string' && obj[field].trim() === '')) {
      missing.push(field);
    }
  });
  
  return missing;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim();
}

// ============================================
// ERROR HANDLING
// ============================================

function handleError(error, context) {
  console.error(`Error in ${context}: ${error.message}`);
  console.error(error.stack);
  
  return {
    success: false,
    error: error.message,
    context: context
  };
}

function successResponse(data, message) {
  return {
    success: true,
    data: data,
    message: message || 'Operacija uspješna'
  };
}

function errorResponse(message, details) {
  return {
    success: false,
    error: message,
    details: details
  };
}
