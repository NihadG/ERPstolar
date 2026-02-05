/**
 * Database Operations
 * CRUD operations for all entities
 */

// ============================================
// PROJECTS CRUD
// ============================================

function getProjects() {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Return projects WITHOUT nested products for initial load (performance)
    const projects = data.slice(1).map(row => {
      const project = rowToObject(headers, row);
      project.products = []; // Will be loaded separately via getProductsByProject
      
      // Convert Date objects to strings (fixes serialization issue)
      if (project.Created_Date instanceof Date) {
        project.Created_Date = project.Created_Date.toISOString();
      }
      if (project.Deadline instanceof Date) {
        project.Deadline = project.Deadline.toISOString();
      }
      
      return project;
    });
    
    return projects;
  } catch (e) {
    console.error('getProjects ERROR:', e.message);
    return [];
  }
}

function getProject(projectId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
    const headers = SHEET_HEADERS.PROJECTS;
    
    const rowIndex = findRowByValue(sheet, 1, projectId);
    if (rowIndex === -1) return null;
    
    const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const project = rowToObject(headers, row);
    project.products = getProductsByProject(projectId);
    
    return project;
  } catch (e) {
    console.error('Error getting project: ' + e.message);
    return null;
  }
}

function saveProject(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
    const headers = SHEET_HEADERS.PROJECTS;
    
    let projectId = data.Project_ID;
    let isNew = false;
    
    if (!projectId) {
      // New project
      projectId = generateUUID();
      data.Project_ID = projectId;
      data.Created_Date = new Date();
      data.Status = data.Status || 'Nacrt';
      isNew = true;
    }
    
    const rowData = objectToRow(headers, data);
    
    if (isNew) {
      sheet.appendRow(rowData);
    } else {
      const rowIndex = findRowByValue(sheet, 1, projectId);
      if (rowIndex === -1) {
        return errorResponse('Projekat nije pronađen');
      }
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    
    return successResponse({ Project_ID: projectId }, isNew ? 'Projekat kreiran' : 'Projekat ažuriran');
  } catch (e) {
    return handleError(e, 'saveProject');
  }
}

function deleteProject(projectId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
    
    const rowIndex = findRowByValue(sheet, 1, projectId);
    if (rowIndex === -1) {
      return errorResponse('Projekat nije pronađen');
    }
    
    // Delete all related products (cascade)
    const products = getProductsByProject(projectId);
    products.forEach(p => deleteProduct(p.Product_ID));
    
    // Delete the project row
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Projekat obrisan');
  } catch (e) {
    return handleError(e, 'deleteProject');
  }
}

function updateProjectStatus(projectId, status) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
    
    const rowIndex = findRowByValue(sheet, 1, projectId);
    if (rowIndex === -1) {
      return errorResponse('Projekat nije pronađen');
    }
    
    // Status is column 7
    sheet.getRange(rowIndex, 7).setValue(status);
    
    return successResponse(null, 'Status ažuriran');
  } catch (e) {
    return handleError(e, 'updateProjectStatus');
  }
}

// ============================================
// PRODUCTS CRUD
// ============================================

function getProductsByProject(projectId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const products = data.slice(1)
      .filter(row => String(row[1]) === String(projectId))
      .map(row => {
        const product = rowToObject(headers, row);
        product.materials = getProductMaterials(product.Product_ID);
        return product;
      });
    
    return products;
  } catch (e) {
    console.error('Error getting products: ' + e.message);
    return [];
  }
}

function getProduct(productId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    const headers = SHEET_HEADERS.PRODUCTS;
    
    const rowIndex = findRowByValue(sheet, 1, productId);
    if (rowIndex === -1) return null;
    
    const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const product = rowToObject(headers, row);
    product.materials = getProductMaterials(productId);
    
    return product;
  } catch (e) {
    console.error('Error getting product: ' + e.message);
    return null;
  }
}

function saveProduct(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    const headers = SHEET_HEADERS.PRODUCTS;
    
    let productId = data.Product_ID;
    let isNew = false;
    
    if (!productId) {
      productId = generateUUID();
      data.Product_ID = productId;
      data.Status = data.Status || 'Na čekanju';
      data.Material_Cost = 0;
      isNew = true;
    }
    
    const rowData = objectToRow(headers, data);
    
    if (isNew) {
      sheet.appendRow(rowData);
    } else {
      const rowIndex = findRowByValue(sheet, 1, productId);
      if (rowIndex === -1) {
        return errorResponse('Proizvod nije pronađen');
      }
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    
    return successResponse({ Product_ID: productId }, isNew ? 'Proizvod kreiran' : 'Proizvod ažuriran');
  } catch (e) {
    return handleError(e, 'saveProduct');
  }
}

function deleteProduct(productId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    
    const rowIndex = findRowByValue(sheet, 1, productId);
    if (rowIndex === -1) {
      return errorResponse('Proizvod nije pronađen');
    }
    
    // Delete all related materials (cascade)
    deleteProductMaterials(productId);
    
    // Delete the product row
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Proizvod obrisan');
  } catch (e) {
    return handleError(e, 'deleteProduct');
  }
}

function updateProductStatus(productId, status) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    
    const rowIndex = findRowByValue(sheet, 1, productId);
    if (rowIndex === -1) {
      return errorResponse('Proizvod nije pronađen');
    }
    
    // Status is column 8
    sheet.getRange(rowIndex, 8).setValue(status);
    
    return successResponse(null, 'Status ažuriran');
  } catch (e) {
    return handleError(e, 'updateProductStatus');
  }
}

function recalculateProductCost(productId) {
  try {
    const ss = getSpreadsheet();
    const materials = getProductMaterials(productId);
    
    const totalCost = materials.reduce((sum, m) => {
      return sum + (parseFloat(m.Total_Price) || 0);
    }, 0);
    
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
    const rowIndex = findRowByValue(sheet, 1, productId);
    
    if (rowIndex !== -1) {
      // Material_Cost is column 9
      sheet.getRange(rowIndex, 9).setValue(totalCost);
    }
    
    return totalCost;
  } catch (e) {
    console.error('Error recalculating product cost: ' + e.message);
    return 0;
  }
}

// ============================================
// PRODUCT MATERIALS CRUD
// ============================================

function getProductMaterials(productId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    return data.slice(1)
      .filter(row => row[1] === productId)
      .map(row => rowToObject(headers, row));
  } catch (e) {
    console.error('Error getting product materials: ' + e.message);
    return [];
  }
}

function addMaterialToProduct(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    const headers = SHEET_HEADERS.PRODUCT_MATERIALS;
    
    // Calculate total price
    const quantity = parseFloat(data.Quantity) || 0;
    const unitPrice = parseFloat(data.Unit_Price) || 0;
    data.Total_Price = quantity * unitPrice;
    
    // Generate ID if new
    if (!data.ID) {
      data.ID = generateUUID();
      data.Status = data.Status || 'Nije naručeno';
    }
    
    const rowData = objectToRow(headers, data);
    sheet.appendRow(rowData);
    
    // Recalculate product cost
    recalculateProductCost(data.Product_ID);
    
    return successResponse({ ID: data.ID }, 'Materijal dodan');
  } catch (e) {
    return handleError(e, 'addMaterialToProduct');
  }
}

function updateProductMaterial(materialId, data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    const headers = SHEET_HEADERS.PRODUCT_MATERIALS;
    
    const rowIndex = findRowByValue(sheet, 1, materialId);
    if (rowIndex === -1) {
      return errorResponse('Materijal nije pronađen');
    }
    
    // Get existing data
    const existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const existing = rowToObject(headers, existingRow);
    
    // Merge with new data
    const merged = { ...existing, ...data };
    
    // Recalculate total price
    const quantity = parseFloat(merged.Quantity) || 0;
    const unitPrice = parseFloat(merged.Unit_Price) || 0;
    merged.Total_Price = quantity * unitPrice;
    
    const rowData = objectToRow(headers, merged);
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    
    // Recalculate product cost
    recalculateProductCost(merged.Product_ID);
    
    return successResponse(null, 'Materijal ažuriran');
  } catch (e) {
    return handleError(e, 'updateProductMaterial');
  }
}

function deleteProductMaterial(materialId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    const rowIndex = findRowByValue(sheet, 1, materialId);
    if (rowIndex === -1) {
      return errorResponse('Materijal nije pronađen');
    }
    
    // Get product ID before deleting
    const productId = sheet.getRange(rowIndex, 2).getValue();
    
    sheet.deleteRow(rowIndex);
    
    // Recalculate product cost
    if (productId) {
      recalculateProductCost(productId);
    }
    
    return successResponse(null, 'Materijal obrisan');
  } catch (e) {
    return handleError(e, 'deleteProductMaterial');
  }
}

function deleteProductMaterials(productId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
    
    if (sheet.getLastRow() <= 1) return;
    
    // Find and delete all rows for this product (from bottom to top)
    const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][0] === productId) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {
    console.error('Error deleting product materials: ' + e.message);
  }
}

// ============================================
// MATERIALS DATABASE CRUD
// ============================================

function getMaterialsCatalog() {
  try {
    return getSheetData(SHEET_NAMES.MATERIALS_DB);
  } catch (e) {
    console.error('Error getting materials catalog: ' + e.message);
    return [];
  }
}

function saveMaterial(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.MATERIALS_DB);
    const headers = SHEET_HEADERS.MATERIALS_DB;
    
    let materialId = data.Material_ID;
    let isNew = false;
    
    if (!materialId) {
      materialId = generateUUID();
      data.Material_ID = materialId;
      isNew = true;
    }
    
    const rowData = objectToRow(headers, data);
    
    if (isNew) {
      sheet.appendRow(rowData);
    } else {
      const rowIndex = findRowByValue(sheet, 1, materialId);
      if (rowIndex === -1) {
        return errorResponse('Materijal nije pronađen');
      }
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    
    return successResponse({ Material_ID: materialId }, isNew ? 'Materijal kreiran' : 'Materijal ažuriran');
  } catch (e) {
    return handleError(e, 'saveMaterial');
  }
}

function deleteMaterial(materialId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.MATERIALS_DB);
    
    const rowIndex = findRowByValue(sheet, 1, materialId);
    if (rowIndex === -1) {
      return errorResponse('Materijal nije pronađen');
    }
    
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Materijal obrisan');
  } catch (e) {
    return handleError(e, 'deleteMaterial');
  }
}

// ============================================
// SUPPLIERS CRUD
// ============================================

function getSuppliers() {
  try {
    return getSheetData(SHEET_NAMES.SUPPLIERS);
  } catch (e) {
    console.error('Error getting suppliers: ' + e.message);
    return [];
  }
}

function saveSupplier(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.SUPPLIERS);
    const headers = SHEET_HEADERS.SUPPLIERS;
    
    let supplierId = data.Supplier_ID;
    let isNew = false;
    
    if (!supplierId) {
      supplierId = generateUUID();
      data.Supplier_ID = supplierId;
      isNew = true;
    }
    
    const rowData = objectToRow(headers, data);
    
    if (isNew) {
      sheet.appendRow(rowData);
    } else {
      const rowIndex = findRowByValue(sheet, 1, supplierId);
      if (rowIndex === -1) {
        return errorResponse('Dobavljač nije pronađen');
      }
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    
    return successResponse({ Supplier_ID: supplierId }, isNew ? 'Dobavljač kreiran' : 'Dobavljač ažuriran');
  } catch (e) {
    return handleError(e, 'saveSupplier');
  }
}

function deleteSupplier(supplierId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.SUPPLIERS);
    
    const rowIndex = findRowByValue(sheet, 1, supplierId);
    if (rowIndex === -1) {
      return errorResponse('Dobavljač nije pronađen');
    }
    
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Dobavljač obrisan');
  } catch (e) {
    return handleError(e, 'deleteSupplier');
  }
}

// ============================================
// WORKERS CRUD
// ============================================

function getWorkers() {
  try {
    return getSheetData(SHEET_NAMES.WORKERS);
  } catch (e) {
    console.error('Error getting workers: ' + e.message);
    return [];
  }
}

function saveWorker(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.WORKERS);
    const headers = SHEET_HEADERS.WORKERS;
    
    let workerId = data.Worker_ID;
    let isNew = false;
    
    if (!workerId) {
      workerId = generateUUID();
      data.Worker_ID = workerId;
      data.Status = data.Status || 'Dostupan';
      isNew = true;
    }
    
    const rowData = objectToRow(headers, data);
    
    if (isNew) {
      sheet.appendRow(rowData);
    } else {
      const rowIndex = findRowByValue(sheet, 1, workerId);
      if (rowIndex === -1) {
        return errorResponse('Radnik nije pronađen');
      }
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    
    return successResponse({ Worker_ID: workerId }, isNew ? 'Radnik kreiran' : 'Radnik ažuriran');
  } catch (e) {
    return handleError(e, 'saveWorker');
  }
}

function deleteWorker(workerId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.WORKERS);
    
    const rowIndex = findRowByValue(sheet, 1, workerId);
    if (rowIndex === -1) {
      return errorResponse('Radnik nije pronađen');
    }
    
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Radnik obrisan');
  } catch (e) {
    return handleError(e, 'deleteWorker');
  }
}
