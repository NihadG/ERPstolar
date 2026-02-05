/**
 * Glass Items Management
 * Specialized handling for glass materials with individual dimensions
 */

// ============================================
// HELPER: ENSURE GLASS SHEET EXISTS
// ============================================

function ensureGlassSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.GLASS_ITEMS);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.GLASS_ITEMS);
    const headers = SHEET_HEADERS.GLASS_ITEMS;
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    console.log('Created Glass_Items sheet');
  }
  
  return sheet;
}

// ============================================
// GLASS ITEMS CRUD
// ============================================

/**
 * Get glass items for a specific product material
 */
function getGlassItems(productMaterialId) {
  try {
    const sheet = ensureGlassSheet();
    
    if (sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    return data.slice(1)
      .filter(row => row[1] === productMaterialId)
      .map(row => rowToObject(headers, row));
  } catch (e) {
    console.error('Error getting glass items: ' + e.message);
    return [];
  }
}

/**
 * Save glass items for a product material (replaces all existing)
 * @param {string} productMaterialId - The product material ID
 * @param {Array} items - Array of glass items with Width, Height, Edge_Processing, Note
 * @param {number} pricePerM2 - Price per square meter
 */
function saveGlassItems(productMaterialId, items, pricePerM2) {
  try {
    const ss = getSpreadsheet();
    const glassSheet = ensureGlassSheet();
    const pmSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    // Delete existing glass items for this product material
    deleteGlassItemsByMaterial(productMaterialId);
    
    // Add new items
    let totalArea = 0;
    let totalPrice = 0;
    
    items.forEach(item => {
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000; // Convert mm² to m²
      const hasEdge = item.Edge_Processing === true || item.Edge_Processing === 'true';
      const itemPrice = area * pricePerM2 * (hasEdge ? 1.10 : 1);
      
      totalArea += area;
      totalPrice += itemPrice;
      
      const glassItem = {
        ID: generateUUID(),
        Product_Material_ID: productMaterialId,
        Order_ID: '',
        Width: width,
        Height: height,
        Area_M2: Math.round(area * 10000) / 10000, // 4 decimal places
        Edge_Processing: hasEdge,
        Note: item.Note || '',
        Status: 'Nije naručeno'
      };
      
      const row = objectToRow(SHEET_HEADERS.GLASS_ITEMS, glassItem);
      glassSheet.appendRow(row);
    });
    
    // Update the product material total
    const pmRowIndex = findRowByValue(pmSheet, 1, productMaterialId);
    if (pmRowIndex !== -1) {
      // Quantity = total m²
      pmSheet.getRange(pmRowIndex, 5).setValue(Math.round(totalArea * 100) / 100);
      // Total Price
      pmSheet.getRange(pmRowIndex, 8).setValue(Math.round(totalPrice * 100) / 100);
    }
    
    return successResponse({
      itemCount: items.length,
      totalArea: Math.round(totalArea * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100
    }, 'Stakla sačuvana');
  } catch (e) {
    return handleError(e, 'saveGlassItems');
  }
}

/**
 * Delete all glass items for a product material
 */
function deleteGlassItemsByMaterial(productMaterialId) {
  try {
    const sheet = ensureGlassSheet();
    
    if (sheet.getLastRow() <= 1) return;
    
    const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][0] === productMaterialId) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {
    console.error('Error deleting glass items: ' + e.message);
  }
}

/**
 * Add a glass material to a product with items
 * @param {object} data - Contains productId, materialId, materialName, supplier, unitPrice, items[]
 */
function addGlassMaterialToProduct(data) {
  try {
    const ss = getSpreadsheet();
    const pmSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    const glassSheet = ensureGlassSheet();
    
    const pricePerM2 = parseFloat(data.unitPrice) || 0;
    const items = data.items || [];
    
    // Calculate totals
    let totalArea = 0;
    let totalPrice = 0;
    
    items.forEach(item => {
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000;
      const hasEdge = item.Edge_Processing === true || item.Edge_Processing === 'true';
      const itemPrice = area * pricePerM2 * (hasEdge ? 1.10 : 1);
      
      totalArea += area;
      totalPrice += itemPrice;
    });
    
    // Create the product material entry
    const productMaterialId = generateUUID();
    
    const pmData = {
      ID: productMaterialId,
      Product_ID: data.productId,
      Material_ID: data.materialId || '',
      Material_Name: data.materialName,
      Quantity: Math.round(totalArea * 100) / 100,
      Unit: 'm²',
      Unit_Price: pricePerM2,
      Total_Price: Math.round(totalPrice * 100) / 100,
      Status: 'Nije naručeno',
      Supplier: data.supplier || '',
      Order_ID: ''
    };
    
    const pmRow = objectToRow(SHEET_HEADERS.PRODUCT_MATERIALS, pmData);
    pmSheet.appendRow(pmRow);
    
    // Add glass items
    items.forEach(item => {
      const qty = parseInt(item.Qty) || 1;
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000;
      const hasEdge = item.Edge_Processing === true || item.Edge_Processing === 'true';
      
      const glassItem = {
        ID: generateUUID(),
        Product_Material_ID: productMaterialId,
        Order_ID: '',
        Qty: qty,
        Width: width,
        Height: height,
        Area_M2: Math.round(area * qty * 10000) / 10000,
        Edge_Processing: hasEdge,
        Note: item.Note || '',
        Status: 'Nije naručeno'
      };
      
      const row = objectToRow(SHEET_HEADERS.GLASS_ITEMS, glassItem);
      glassSheet.appendRow(row);
    });
    
    return successResponse({
      productMaterialId: productMaterialId,
      itemCount: items.length,
      totalArea: Math.round(totalArea * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100
    }, 'Staklo dodano');
  } catch (e) {
    return handleError(e, 'addGlassMaterialToProduct');
  }
}

/**
 * Update glass items for an existing product material
 * @param {object} data - Contains productMaterialId, unitPrice, items[]
 */
function updateGlassMaterial(data) {
  try {
    const ss = getSpreadsheet();
    const pmSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    const glassSheet = ensureGlassSheet();
    
    const productMaterialId = data.productMaterialId;
    const pricePerM2 = parseFloat(data.unitPrice) || 0;
    const items = data.items || [];
    
    // Delete existing glass items
    deleteGlassItemsByMaterial(productMaterialId);
    
    // Calculate totals and add new items
    let totalArea = 0;
    let totalPrice = 0;
    
    items.forEach(item => {
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000;
      const hasEdge = item.Edge_Processing === true || item.Edge_Processing === 'true';
      const itemPrice = area * pricePerM2 * (hasEdge ? 1.10 : 1);
      
      totalArea += area;
      totalPrice += itemPrice;
      
      if (width > 0 && height > 0) {
        const qty = parseInt(item.Qty) || 1;
        const glassItem = {
          ID: generateUUID(),
          Product_Material_ID: productMaterialId,
          Order_ID: '',
          Qty: qty,
          Width: width,
          Height: height,
          Area_M2: Math.round(area * qty * 10000) / 10000,
          Edge_Processing: hasEdge,
          Note: item.Note || '',
          Status: 'Nije naručeno'
        };
        
        const row = objectToRow(SHEET_HEADERS.GLASS_ITEMS, glassItem);
        glassSheet.appendRow(row);
      }
    });
    
    // Update the product material totals
    const pmRowIndex = findRowByValue(pmSheet, 1, productMaterialId);
    if (pmRowIndex !== -1) {
      // Quantity = total m²
      pmSheet.getRange(pmRowIndex, 5).setValue(Math.round(totalArea * 100) / 100);
      // Unit Price
      pmSheet.getRange(pmRowIndex, 7).setValue(pricePerM2);
      // Total Price
      pmSheet.getRange(pmRowIndex, 8).setValue(Math.round(totalPrice * 100) / 100);
    }
    
    return successResponse({
      productMaterialId: productMaterialId,
      itemCount: items.filter(i => (parseFloat(i.Width) || 0) > 0 && (parseFloat(i.Height) || 0) > 0).length,
      totalArea: Math.round(totalArea * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100
    }, 'Staklo ažurirano');
  } catch (e) {
    return handleError(e, 'updateGlassMaterial');
  }
}

/**
 * Check if a material is glass type
 */
function isGlassMaterial(materialId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.MATERIALS_DB);
    
    const rowIndex = findRowByValue(sheet, 1, materialId);
    if (rowIndex === -1) return false;
    
    // Check Is_Glass column (8th column - index 7)
    const isGlass = sheet.getRange(rowIndex, 8).getValue();
    return isGlass === true || isGlass === 'true' || isGlass === 'TRUE';
  } catch (e) {
    console.error('Error checking if glass material: ' + e.message);
    return false;
  }
}

/**
 * Update glass items status when ordered
 */
function markGlassItemsOrdered(productMaterialId, orderId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.GLASS_ITEMS);
    
    if (sheet.getLastRow() <= 1) return;
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const pmIdIndex = headers.indexOf('Product_Material_ID');
    const orderIdIndex = headers.indexOf('Order_ID');
    const statusIndex = headers.indexOf('Status');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][pmIdIndex] === productMaterialId) {
        sheet.getRange(i + 1, orderIdIndex + 1).setValue(orderId);
        sheet.getRange(i + 1, statusIndex + 1).setValue('Naručeno');
      }
    }
  } catch (e) {
    console.error('Error marking glass items ordered: ' + e.message);
  }
}

/**
 * Update glass items status when received
 */
function markGlassItemsReceived(productMaterialId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.GLASS_ITEMS);
    
    if (sheet.getLastRow() <= 1) return;
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const pmIdIndex = headers.indexOf('Product_Material_ID');
    const statusIndex = headers.indexOf('Status');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][pmIdIndex] === productMaterialId) {
        sheet.getRange(i + 1, statusIndex + 1).setValue('Primljeno');
      }
    }
  } catch (e) {
    console.error('Error marking glass items received: ' + e.message);
  }
}
