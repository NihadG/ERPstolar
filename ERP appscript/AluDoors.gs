/**
 * Alu Door Items Management
 * Specialized handling for aluminum doors with glass infill
 */

// ============================================
// HELPER: ENSURE ALU DOOR SHEET EXISTS
// ============================================

function ensureAluDoorSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.ALU_DOOR_ITEMS);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.ALU_DOOR_ITEMS);
    const headers = SHEET_HEADERS.ALU_DOOR_ITEMS;
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    console.log('Created Alu_Door_Items sheet');
  }
  
  return sheet;
}

// ============================================
// ALU DOOR ITEMS CRUD
// ============================================

/**
 * Get alu door items for a specific product material
 */
function getAluDoorItems(productMaterialId) {
  try {
    const sheet = ensureAluDoorSheet();
    
    if (sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    return data.slice(1)
      .filter(row => row[1] === productMaterialId)
      .map(row => rowToObject(headers, row));
  } catch (e) {
    console.error('Error getting alu door items: ' + e.message);
    return [];
  }
}

/**
 * Add an alu door material to a product with items
 * @param {object} data - Contains productId, materialId, materialName, supplier, unitPrice, items[]
 */
function addAluDoorMaterialToProduct(data) {
  try {
    const ss = getSpreadsheet();
    const pmSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    const aluDoorSheet = ensureAluDoorSheet();
    
    const pricePerM2 = parseFloat(data.unitPrice) || 200; // Default 200 KM/m²
    const items = data.items || [];
    
    // Calculate totals
    let totalArea = 0;
    let totalPrice = 0;
    let totalQty = 0;
    
    items.forEach(item => {
      const qty = parseInt(item.Qty) || 1;
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000; // mm² to m²
      const areaTotal = area * qty;
      const itemPrice = areaTotal * pricePerM2;
      
      totalQty += qty;
      totalArea += areaTotal;
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
    
    // Add alu door items
    items.forEach(item => {
      const qty = parseInt(item.Qty) || 1;
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000;
      const areaTotal = area * qty;
      const itemPrice = areaTotal * pricePerM2;
      
      const aluDoorItem = {
        ID: generateUUID(),
        Product_Material_ID: productMaterialId,
        Order_ID: '',
        Qty: qty,
        Width: width,
        Height: height,
        Frame_Type: item.Frame_Type || 'uski',
        Glass_Type: item.Glass_Type || 'float',
        Frame_Color: item.Frame_Color || '',
        Hinge_Color: item.Hinge_Color || '',
        Hinge_Type: item.Hinge_Type || 'ravne',
        Hinge_Side: item.Hinge_Side || 'lijevo',
        Hinge_Layout: item.Hinge_Layout || 'osnovna',
        Hinge_Positions: JSON.stringify(item.Hinge_Positions || []),
        Integrated_Handle: item.Integrated_Handle === true || item.Integrated_Handle === 'true',
        Area_M2: Math.round(areaTotal * 10000) / 10000,
        Unit_Price: pricePerM2,
        Total_Price: Math.round(itemPrice * 100) / 100,
        Note: item.Note || '',
        Status: 'Nije naručeno'
      };
      
      const row = objectToRow(SHEET_HEADERS.ALU_DOOR_ITEMS, aluDoorItem);
      aluDoorSheet.appendRow(row);
    });
    
    return successResponse({
      productMaterialId: productMaterialId,
      itemCount: items.length,
      totalQty: totalQty,
      totalArea: Math.round(totalArea * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100
    }, 'Alu vrata dodana');
  } catch (e) {
    return handleError(e, 'addAluDoorMaterialToProduct');
  }
}

/**
 * Update alu door items for an existing product material
 * @param {object} data - Contains productMaterialId, unitPrice, items[]
 */
function updateAluDoorMaterial(data) {
  try {
    const ss = getSpreadsheet();
    const pmSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    const aluDoorSheet = ensureAluDoorSheet();
    
    const productMaterialId = data.productMaterialId;
    const pricePerM2 = parseFloat(data.unitPrice) || 200;
    const items = data.items || [];
    
    // Delete existing alu door items
    deleteAluDoorItemsByMaterial(productMaterialId);
    
    // Calculate totals and add new items
    let totalArea = 0;
    let totalPrice = 0;
    let totalQty = 0;
    
    items.forEach(item => {
      const qty = parseInt(item.Qty) || 1;
      const width = parseFloat(item.Width) || 0;
      const height = parseFloat(item.Height) || 0;
      const area = (width * height) / 1000000;
      const areaTotal = area * qty;
      const itemPrice = areaTotal * pricePerM2;
      
      totalQty += qty;
      totalArea += areaTotal;
      totalPrice += itemPrice;
      
      if (width > 0 && height > 0) {
        const aluDoorItem = {
          ID: generateUUID(),
          Product_Material_ID: productMaterialId,
          Order_ID: '',
          Qty: qty,
          Width: width,
          Height: height,
          Frame_Type: item.Frame_Type || 'uski',
          Glass_Type: item.Glass_Type || 'float',
          Frame_Color: item.Frame_Color || '',
          Hinge_Color: item.Hinge_Color || '',
          Hinge_Type: item.Hinge_Type || 'ravne',
          Hinge_Side: item.Hinge_Side || 'lijevo',
          Hinge_Layout: item.Hinge_Layout || 'osnovna',
          Hinge_Positions: JSON.stringify(item.Hinge_Positions || []),
          Integrated_Handle: item.Integrated_Handle === true || item.Integrated_Handle === 'true',
          Area_M2: Math.round(areaTotal * 10000) / 10000,
          Unit_Price: pricePerM2,
          Total_Price: Math.round(itemPrice * 100) / 100,
          Note: item.Note || '',
          Status: 'Nije naručeno'
        };
        
        const row = objectToRow(SHEET_HEADERS.ALU_DOOR_ITEMS, aluDoorItem);
        aluDoorSheet.appendRow(row);
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
      totalQty: totalQty,
      totalArea: Math.round(totalArea * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100
    }, 'Alu vrata ažurirana');
  } catch (e) {
    return handleError(e, 'updateAluDoorMaterial');
  }
}

/**
 * Delete all alu door items for a product material
 */
function deleteAluDoorItemsByMaterial(productMaterialId) {
  try {
    const sheet = ensureAluDoorSheet();
    
    if (sheet.getLastRow() <= 1) return;
    
    const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][0] === productMaterialId) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {
    console.error('Error deleting alu door items: ' + e.message);
  }
}

/**
 * Check if a material is alu door type
 */
function isAluDoorMaterial(materialId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.MATERIALS_DB);
    
    const rowIndex = findRowByValue(sheet, 1, materialId);
    if (rowIndex === -1) return false;
    
    // Check Is_Alu_Door column (9th column - index 8) or Category
    const data = sheet.getRange(rowIndex, 1, 1, 9).getValues()[0];
    const headers = SHEET_HEADERS.MATERIALS_DB;
    const isAluDoorIndex = headers.indexOf('Is_Alu_Door');
    const categoryIndex = headers.indexOf('Category');
    
    if (isAluDoorIndex !== -1 && data[isAluDoorIndex]) {
      const isAluDoor = data[isAluDoorIndex];
      return isAluDoor === true || isAluDoor === 'true' || isAluDoor === 'TRUE';
    }
    
    // Fallback: check category
    if (categoryIndex !== -1) {
      return data[categoryIndex] === 'Alu vrata';
    }
    
    return false;
  } catch (e) {
    console.error('Error checking if alu door material: ' + e.message);
    return false;
  }
}

/**
 * Update alu door items status when ordered
 */
function markAluDoorItemsOrdered(productMaterialId, orderId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ALU_DOOR_ITEMS);
    
    if (!sheet || sheet.getLastRow() <= 1) return;
    
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
    console.error('Error marking alu door items ordered: ' + e.message);
  }
}

/**
 * Update alu door items status when received
 */
function markAluDoorItemsReceived(productMaterialId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ALU_DOOR_ITEMS);
    
    if (!sheet || sheet.getLastRow() <= 1) return;
    
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
    console.error('Error marking alu door items received: ' + e.message);
  }
}
