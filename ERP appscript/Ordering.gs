/**
 * Ordering Management
 * Material ordering workflow and status automation
 */

// ============================================
// ORDERS CRUD
// ============================================

function getOrders(filters) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    let orders = data.slice(1).map(row => {
      const order = rowToObject(headers, row);
      order.items = getOrderItems(order.Order_ID);
      
      // Convert Date objects to strings (fixes serialization issue)
      if (order.Order_Date instanceof Date) {
        order.Order_Date = order.Order_Date.toISOString();
      }
      if (order.Expected_Delivery instanceof Date) {
        order.Expected_Delivery = order.Expected_Delivery.toISOString();
      }
      
      return order;
    });
    
    // Apply filters
    if (filters) {
      if (filters.supplierId) {
        orders = orders.filter(o => o.Supplier_ID === filters.supplierId);
      }
      if (filters.status) {
        orders = orders.filter(o => o.Status === filters.status);
      }
    }
    
    return orders;
  } catch (e) {
    console.error('Error getting orders: ' + e.message);
    return [];
  }
}

function getOrder(orderId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    const headers = SHEET_HEADERS.ORDERS;
    
    const rowIndex = findRowByValue(sheet, 1, orderId);
    if (rowIndex === -1) return null;
    
    const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const order = rowToObject(headers, row);
    order.items = getOrderItems(orderId);
    
    return order;
  } catch (e) {
    console.error('Error getting order: ' + e.message);
    return null;
  }
}

function createOrder(data) {
  try {
    const ss = getSpreadsheet();
    const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    const orderItemsSheet = ss.getSheetByName(SHEET_NAMES.ORDER_ITEMS);
    const materialsSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    // Create order
    const orderId = generateUUID();
    const orderNumber = generateOrderNumber();
    
    const orderData = {
      Order_ID: orderId,
      Order_Number: orderNumber,
      Supplier_ID: data.Supplier_ID || '',
      Supplier_Name: data.Supplier_Name || '',
      Order_Date: new Date(),
      Status: 'Nacrt',
      Expected_Delivery: data.Expected_Delivery || '',
      Total_Amount: 0,
      Notes: data.Notes || ''
    };
    
    const orderRow = objectToRow(SHEET_HEADERS.ORDERS, orderData);
    ordersSheet.appendRow(orderRow);
    
    // Add items and update material statuses
    let totalAmount = 0;
    if (data.items && Array.isArray(data.items)) {
      data.items.forEach(item => {
        const itemData = {
          ID: generateUUID(),
          Order_ID: orderId,
          Product_Material_ID: item.Product_Material_ID || '',
          Product_ID: item.Product_ID || '',
          Product_Name: item.Product_Name || '',
          Project_ID: item.Project_ID || '',
          Material_Name: item.Material_Name || '',
          Quantity: item.Quantity || 0,
          Unit: item.Unit || '',
          Expected_Price: item.Expected_Price || 0,
          Actual_Price: '',
          Received_Quantity: 0,
          Status: 'Na čekanju'
        };
        
        totalAmount += (parseFloat(itemData.Quantity) || 0) * (parseFloat(itemData.Expected_Price) || 0);
        
        const itemRow = objectToRow(SHEET_HEADERS.ORDER_ITEMS, itemData);
        orderItemsSheet.appendRow(itemRow);
        
        // Update material status to "Naručeno" immediately when order is created
        if (item.Product_Material_ID && materialsSheet) {
          const materialRowIndex = findRowByValue(materialsSheet, 1, item.Product_Material_ID);
          if (materialRowIndex !== -1) {
            materialsSheet.getRange(materialRowIndex, 9).setValue('Naručeno'); // Status column
            materialsSheet.getRange(materialRowIndex, 11).setValue(orderId);   // Order_ID column
          }
        }
      });
    }
    
    // Update total amount
    const orderRowIndex = findRowByValue(ordersSheet, 1, orderId);
    if (orderRowIndex !== -1) {
      ordersSheet.getRange(orderRowIndex, 8).setValue(totalAmount);
    }
    
    return successResponse({ 
      Order_ID: orderId, 
      Order_Number: orderNumber 
    }, 'Narudžba kreirana');
  } catch (e) {
    return handleError(e, 'createOrder');
  }
}

function deleteOrder(orderId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    
    const rowIndex = findRowByValue(sheet, 1, orderId);
    if (rowIndex === -1) {
      return errorResponse('Narudžba nije pronađena');
    }
    
    // Delete order items
    deleteOrderItems(orderId);
    
    // Delete order
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Narudžba obrisana');
  } catch (e) {
    return handleError(e, 'deleteOrder');
  }
}

// ============================================
// ORDER ITEMS
// ============================================

function getOrderItems(orderId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ORDER_ITEMS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    return data.slice(1)
      .filter(row => row[1] === orderId)
      .map(row => rowToObject(headers, row));
  } catch (e) {
    console.error('Error getting order items: ' + e.message);
    return [];
  }
}

function deleteOrderItems(orderId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ORDER_ITEMS);
    
    if (sheet.getLastRow() <= 1) return;
    
    const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][0] === orderId) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {
    console.error('Error deleting order items: ' + e.message);
  }
}

/**
 * Delete specific order items by their IDs
 * @param {Array} itemIds - Array of order item IDs to delete
 */
function deleteOrderItemsByIds(itemIds) {
  try {
    const ss = getSpreadsheet();
    const orderItemsSheet = ss.getSheetByName(SHEET_NAMES.ORDER_ITEMS);
    const materialsSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    if (!orderItemsSheet || orderItemsSheet.getLastRow() <= 1) {
      return successResponse(null, 'Nema stavki za brisanje');
    }
    
    // Get all order items data
    const data = orderItemsSheet.getDataRange().getValues();
    const headers = data[0];
    
    // Find rows to delete and material IDs to reset (iterate backwards)
    for (let i = data.length - 1; i >= 1; i--) {
      const itemId = data[i][0]; // ID column
      if (itemIds.includes(itemId)) {
        // Get Product_Material_ID before deleting
        const productMaterialId = data[i][2]; // Product_Material_ID column
        
        // Reset material status to "Nije naručeno"
        if (productMaterialId && materialsSheet) {
          const materialRowIndex = findRowByValue(materialsSheet, 1, productMaterialId);
          if (materialRowIndex !== -1) {
            materialsSheet.getRange(materialRowIndex, 9).setValue('Nije naručeno'); // Status column
            materialsSheet.getRange(materialRowIndex, 11).setValue('');              // Clear Order_ID
          }
        }
        
        // Delete the row
        orderItemsSheet.deleteRow(i + 1);
      }
    }
    
    return successResponse(null, 'Stavke obrisane');
  } catch (e) {
    return handleError(e, 'deleteOrderItemsByIds');
  }
}

// ============================================
// ORDERABLE MATERIALS
// ============================================

function getOrderableMaterials(filters) {
  try {
    const ss = getSpreadsheet();
    const materialsSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    if (!materialsSheet || materialsSheet.getLastRow() <= 1) {
      return [];
    }
    
    // Batch load all data ONCE (not per material!)
    const productsSheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    const projectsSheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
    
    // Create lookup maps for O(1) access
    const productMap = new Map();
    if (productsSheet && productsSheet.getLastRow() > 1) {
      const pData = productsSheet.getDataRange().getValues();
      const pHeaders = pData[0];
      pData.slice(1).forEach(row => {
        const product = rowToObject(pHeaders, row);
        productMap.set(product.Product_ID, product);
      });
    }
    
    const projectMap = new Map();
    if (projectsSheet && projectsSheet.getLastRow() > 1) {
      const prData = projectsSheet.getDataRange().getValues();
      const prHeaders = prData[0];
      prData.slice(1).forEach(row => {
        const project = rowToObject(prHeaders, row);
        projectMap.set(project.Project_ID, project);
      });
    }
    
    // Get materials data
    const data = materialsSheet.getDataRange().getValues();
    const headers = data[0];
    
    // Filter and enrich materials
    let materials = data.slice(1)
      .map(row => rowToObject(headers, row))
      .filter(m => m.Status === 'Nije naručeno' || !m.Status)
      .map(m => {
        // O(1) lookup instead of getProduct() call
        const product = productMap.get(m.Product_ID);
        if (product) {
          m.Product_Name = product.Name;
          m.Project_ID = product.Project_ID;
          
          // O(1) lookup instead of getProject() call
          const project = projectMap.get(product.Project_ID);
          if (project) {
            m.Project_Name = project.Client_Name;
          }
        }
        return m;
      });
    
    // Apply filters if provided
    if (filters) {
      if (filters.projectId) {
        materials = materials.filter(m => m.Project_ID === filters.projectId);
      }
      if (filters.productId) {
        materials = materials.filter(m => m.Product_ID === filters.productId);
      }
      if (filters.supplier) {
        materials = materials.filter(m => m.Supplier === filters.supplier);
      }
    }
    
    return materials;
  } catch (e) {
    console.error('Error getting orderable materials: ' + e.message);
    return [];
  }
}

// ============================================
// ORDER STATUS AUTOMATION
// ============================================

function markOrderSent(orderId) {
  try {
    const ss = getSpreadsheet();
    const orderSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    const materialSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    const orderRowIndex = findRowByValue(orderSheet, 1, orderId);
    if (orderRowIndex === -1) {
      return errorResponse('Narudžba nije pronađena');
    }
    
    // Update order status
    orderSheet.getRange(orderRowIndex, 6).setValue('Poslano');
    
    // Get order items and update material statuses
    const items = getOrderItems(orderId);
    
    const affectedProducts = new Set();
    const affectedProjects = new Set();
    
    items.forEach(item => {
      if (item.Product_Material_ID) {
        // Update material status to "Naručeno"
        const materialRowIndex = findRowByValue(materialSheet, 1, item.Product_Material_ID);
        if (materialRowIndex !== -1) {
          materialSheet.getRange(materialRowIndex, 9).setValue('Naručeno'); // Status column
          materialSheet.getRange(materialRowIndex, 11).setValue(orderId);   // Order_ID column
        }
        
        if (item.Product_ID) affectedProducts.add(item.Product_ID);
        if (item.Project_ID) affectedProjects.add(item.Project_ID);
      }
    });
    
    // Update product statuses
    affectedProducts.forEach(productId => {
      const product = getProduct(productId);
      if (product && product.Status === 'Na čekanju') {
        updateProductStatus(productId, 'Materijali naručeni');
      }
    });
    
    // Update project statuses
    affectedProjects.forEach(projectId => {
      const project = getProject(projectId);
      if (project && project.Status === 'Odobreno') {
        updateProjectStatus(projectId, 'U proizvodnji');
      }
    });
    
    return successResponse(null, 'Narudžba poslana');
  } catch (e) {
    return handleError(e, 'markOrderSent');
  }
}

function markMaterialsReceived(orderItemIds) {
  try {
    const ss = getSpreadsheet();
    const orderItemsSheet = ss.getSheetByName(SHEET_NAMES.ORDER_ITEMS);
    const materialSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    const affectedProducts = new Set();
    const affectedProjects = new Set();
    
    orderItemIds.forEach(itemId => {
      const itemRowIndex = findRowByValue(orderItemsSheet, 1, itemId);
      if (itemRowIndex === -1) return;
      
      // Get item data
      const itemRow = orderItemsSheet.getRange(itemRowIndex, 1, 1, SHEET_HEADERS.ORDER_ITEMS.length).getValues()[0];
      const item = rowToObject(SHEET_HEADERS.ORDER_ITEMS, itemRow);
      
      // Update order item status
      orderItemsSheet.getRange(itemRowIndex, 13).setValue('Primljeno'); // Status column
      
      // Update material status
      if (item.Product_Material_ID) {
        const materialRowIndex = findRowByValue(materialSheet, 1, item.Product_Material_ID);
        if (materialRowIndex !== -1) {
          materialSheet.getRange(materialRowIndex, 9).setValue('Primljeno');
        }
      }
      
      if (item.Product_ID) affectedProducts.add(item.Product_ID);
      if (item.Project_ID) affectedProjects.add(item.Project_ID);
    });
    
    // Check if all materials for products are received
    affectedProducts.forEach(productId => {
      if (allMaterialsReceived(productId)) {
        updateProductStatus(productId, 'Materijali spremni');
      }
    });
    
    // Check if all materials for project are received
    affectedProjects.forEach(projectId => {
      if (allProjectMaterialsReceived(projectId)) {
        updateProjectStatus(projectId, 'Sklapanje');
      }
    });
    
    return successResponse(null, 'Materijali primljeni');
  } catch (e) {
    return handleError(e, 'markMaterialsReceived');
  }
}

function allMaterialsReceived(productId) {
  const materials = getProductMaterials(productId);
  return materials.every(m => m.Status === 'Primljeno' || m.Status === 'U upotrebi' || m.Status === 'Instalirano');
}

function allProjectMaterialsReceived(projectId) {
  const products = getProductsByProject(projectId);
  return products.every(p => {
    const materials = getProductMaterials(p.Product_ID);
    return materials.every(m => m.Status === 'Primljeno' || m.Status === 'U upotrebi' || m.Status === 'Instalirano');
  });
}
