/**
 * Offers Management
 * Create, manage, and calculate offer pricing
 */

// ============================================
// OFFERS CRUD
// ============================================

function getOffers(projectId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    let offers = data.slice(1).map(row => {
      const offer = rowToObject(headers, row);
      
      // Convert Date objects to strings (fixes serialization issue)
      if (offer.Created_Date instanceof Date) {
        offer.Created_Date = offer.Created_Date.toISOString();
      }
      if (offer.Valid_Until instanceof Date) {
        offer.Valid_Until = offer.Valid_Until.toISOString();
      }
      if (offer.Accepted_Date instanceof Date) {
        offer.Accepted_Date = offer.Accepted_Date.toISOString();
      }
      
      return offer;
    });
    
    if (projectId) {
      offers = offers.filter(o => o.Project_ID === projectId);
    }
    
    // Add project name to each offer
    offers.forEach(offer => {
      const project = getProject(offer.Project_ID);
      if (project) {
        offer.Client_Name = project.Client_Name;
        offer.Project_Name = project.Client_Name;
      }
    });
    
    return offers;
  } catch (e) {
    console.error('Error getting offers: ' + e.message);
    return [];
  }
}

function getOffer(offerId) {
  try {
    console.log('getOffer called with ID:', offerId);
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    const headers = SHEET_HEADERS.OFFERS;
    
    const rowIndex = findRowByValue(sheet, 1, offerId);
    console.log('Found offer at row:', rowIndex);
    
    if (rowIndex === -1) {
      console.log('Offer not found for ID:', offerId);
      return null;
    }
    
    const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const offer = rowToObject(headers, row);
    
    // Convert Date objects to strings (fixes serialization issue)
    if (offer.Created_Date instanceof Date) {
      offer.Created_Date = offer.Created_Date.toISOString();
    }
    if (offer.Valid_Until instanceof Date) {
      offer.Valid_Until = offer.Valid_Until.toISOString();
    }
    if (offer.Accepted_Date instanceof Date) {
      offer.Accepted_Date = offer.Accepted_Date.toISOString();
    }
    
    // Get offer products
    offer.products = getOfferProducts(offerId);
    console.log('Found products:', offer.products.length);
    
    // Get project info
    const project = getProject(offer.Project_ID);
    if (project) {
      offer.Client_Name = project.Client_Name;
      offer.Client_Phone = project.Client_Phone;
      offer.Client_Email = project.Client_Email;
      offer.Address = project.Address;
    }
    
    console.log('Returning offer:', offer.Offer_Number);
    return offer;
  } catch (e) {
    console.error('Error getting offer: ' + e.message);
    console.error(e.stack);
    return null;
  }
}

function createOffer(projectId) {
  try {
    const ss = getSpreadsheet();
    const offersSheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    const offerProductsSheet = ss.getSheetByName(SHEET_NAMES.OFFER_PRODUCTS);
    
    // Get project and its products
    const project = getProject(projectId);
    if (!project) {
      return errorResponse('Projekat nije pronađen');
    }
    
    // Create new offer
    const offerId = generateUUID();
    const offerNumber = generateOfferNumber();
    
    const offerData = {
      Offer_ID: offerId,
      Project_ID: projectId,
      Offer_Number: offerNumber,
      Created_Date: new Date(),
      Valid_Until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
      Status: 'Nacrt',
      Transport_Cost: 0,
      Onsite_Assembly: false,
      Onsite_Discount: 0,
      Subtotal: 0,
      Total: 0,
      Notes: '',
      Accepted_Date: ''
    };
    
    const offerRow = objectToRow(SHEET_HEADERS.OFFERS, offerData);
    offersSheet.appendRow(offerRow);
    
    // Add all products to offer
    const products = project.products || [];
    products.forEach(product => {
      const materialCost = parseFloat(product.Material_Cost) || 0;
      
      const offerProductData = {
        ID: generateUUID(),
        Offer_ID: offerId,
        Product_ID: product.Product_ID,
        Product_Name: product.Name,
        Quantity: product.Quantity || 1,
        Included: true,
        Material_Cost: materialCost,
        Margin: 0,
        Margin_Type: 'Fixed',
        LED_Meters: 0,
        LED_Price: 15, // Default LED price
        LED_Total: 0,
        Grouting: false,
        Grouting_Price: 0,
        Sink_Faucet: false,
        Sink_Faucet_Price: 0,
        Transport_Share: 0,
        Discount_Share: 0,
        Selling_Price: materialCost,
        Total_Price: materialCost * (product.Quantity || 1)
      };
      
      const productRow = objectToRow(SHEET_HEADERS.OFFER_PRODUCTS, offerProductData);
      offerProductsSheet.appendRow(productRow);
    });
    
    return successResponse({ 
      Offer_ID: offerId, 
      Offer_Number: offerNumber 
    }, 'Ponuda kreirana');
  } catch (e) {
    return handleError(e, 'createOffer');
  }
}

function saveOffer(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    const headers = SHEET_HEADERS.OFFERS;
    
    const offerId = data.Offer_ID;
    if (!offerId) {
      return errorResponse('ID ponude je obavezan');
    }
    
    const rowIndex = findRowByValue(sheet, 1, offerId);
    if (rowIndex === -1) {
      return errorResponse('Ponuda nije pronađena');
    }
    
    // Update offer row
    const rowData = objectToRow(headers, data);
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    
    // Update offer products if provided
    if (data.products && Array.isArray(data.products)) {
      data.products.forEach(product => {
        updateOfferProduct(product);
      });
    }
    
    // Recalculate totals
    calculateOfferTotals(offerId);
    
    return successResponse({ Offer_ID: offerId }, 'Ponuda sačuvana');
  } catch (e) {
    return handleError(e, 'saveOffer');
  }
}

function deleteOffer(offerId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    
    const rowIndex = findRowByValue(sheet, 1, offerId);
    if (rowIndex === -1) {
      return errorResponse('Ponuda nije pronađena');
    }
    
    // Delete offer products
    deleteOfferProducts(offerId);
    
    // Delete offer
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Ponuda obrisana');
  } catch (e) {
    return handleError(e, 'deleteOffer');
  }
}

function updateOfferStatus(offerId, status) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    
    const rowIndex = findRowByValue(sheet, 1, offerId);
    if (rowIndex === -1) {
      return errorResponse('Ponuda nije pronađena');
    }
    
    // Status is column 6
    sheet.getRange(rowIndex, 6).setValue(status);
    
    // If accepted, set accepted date and update project status
    if (status === 'Prihvaćeno') {
      sheet.getRange(rowIndex, 13).setValue(new Date()); // Accepted_Date
      
      // Get offer to find project
      const offer = getOffer(offerId);
      if (offer && offer.Project_ID) {
        updateProjectStatus(offer.Project_ID, 'Odobreno');
      }
    }
    
    return successResponse(null, 'Status ponude ažuriran');
  } catch (e) {
    return handleError(e, 'updateOfferStatus');
  }
}

// ============================================
// OFFER PRODUCTS
// ============================================

function getOfferProducts(offerId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFER_PRODUCTS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const products = data.slice(1)
      .filter(row => String(row[1]) === String(offerId))
      .map(row => {
        const product = rowToObject(headers, row);
        product.extras = getOfferProductExtras(product.ID);
        return product;
      });
    
    return products;
  } catch (e) {
    console.error('Error getting offer products: ' + e.message);
    return [];
  }
}

function updateOfferProduct(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFER_PRODUCTS);
    const headers = SHEET_HEADERS.OFFER_PRODUCTS;
    
    const productId = data.ID;
    if (!productId) return;
    
    const rowIndex = findRowByValue(sheet, 1, productId);
    if (rowIndex === -1) return;
    
    // Calculate LED total
    if (data.LED_Meters && data.LED_Price) {
      data.LED_Total = parseFloat(data.LED_Meters) * parseFloat(data.LED_Price);
    }
    
    // Calculate selling price
    const materialCost = parseFloat(data.Material_Cost) || 0;
    const margin = parseFloat(data.Margin) || 0;
    const ledTotal = parseFloat(data.LED_Total) || 0;
    const groutingPrice = data.Grouting ? (parseFloat(data.Grouting_Price) || 0) : 0;
    const sinkPrice = data.Sink_Faucet ? (parseFloat(data.Sink_Faucet_Price) || 0) : 0;
    
    // Get extras total
    const extrasTotal = (data.extras || []).reduce((sum, e) => sum + (parseFloat(e.Total) || 0), 0);
    
    // Calculate margin (percentage or fixed)
    let marginAmount = margin;
    if (data.Margin_Type === 'Percentage') {
      marginAmount = materialCost * (margin / 100);
    }
    
    data.Selling_Price = materialCost + marginAmount + ledTotal + groutingPrice + sinkPrice + extrasTotal;
    data.Total_Price = data.Selling_Price * (parseFloat(data.Quantity) || 1);
    
    const rowData = objectToRow(headers, data);
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    
  } catch (e) {
    console.error('Error updating offer product: ' + e.message);
  }
}

function deleteOfferProducts(offerId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFER_PRODUCTS);
    
    if (sheet.getLastRow() <= 1) return;
    
    const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    
    for (let i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]) === String(offerId)) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {
    console.error('Error deleting offer products: ' + e.message);
  }
}

// ============================================
// OFFER PRODUCT EXTRAS
// ============================================

function getOfferProductExtras(offerProductId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFER_EXTRAS);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    return data.slice(1)
      .filter(row => String(row[1]) === String(offerProductId))
      .map(row => rowToObject(headers, row));
  } catch (e) {
    console.error('Error getting offer product extras: ' + e.message);
    return [];
  }
}

function addOfferProductExtra(data) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFER_EXTRAS);
    const headers = SHEET_HEADERS.OFFER_EXTRAS;
    
    if (!data.ID) {
      data.ID = generateUUID();
    }
    
    // Calculate total
    data.Total = (parseFloat(data.Quantity) || 0) * (parseFloat(data.Unit_Price) || 0);
    
    const rowData = objectToRow(headers, data);
    sheet.appendRow(rowData);
    
    return successResponse({ ID: data.ID }, 'Dodatak dodan');
  } catch (e) {
    return handleError(e, 'addOfferProductExtra');
  }
}

function deleteOfferProductExtra(extraId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.OFFER_EXTRAS);
    
    const rowIndex = findRowByValue(sheet, 1, extraId);
    if (rowIndex === -1) {
      return errorResponse('Dodatak nije pronađen');
    }
    
    sheet.deleteRow(rowIndex);
    
    return successResponse(null, 'Dodatak obrisan');
  } catch (e) {
    return handleError(e, 'deleteOfferProductExtra');
  }
}

// ============================================
// OFFER CALCULATIONS
// ============================================

function calculateOfferTotals(offerId) {
  try {
    const ss = getSpreadsheet();
    const offerSheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    const productsSheet = ss.getSheetByName(SHEET_NAMES.OFFER_PRODUCTS);
    
    const offerRowIndex = findRowByValue(offerSheet, 1, offerId);
    if (offerRowIndex === -1) return;
    
    // Get offer data
    const offerRow = offerSheet.getRange(offerRowIndex, 1, 1, SHEET_HEADERS.OFFERS.length).getValues()[0];
    const offer = rowToObject(SHEET_HEADERS.OFFERS, offerRow);
    
    // Get included products
    const products = getOfferProducts(offerId).filter(p => p.Included);
    
    // Calculate subtotal
    const subtotal = products.reduce((sum, p) => sum + (parseFloat(p.Total_Price) || 0), 0);
    
    // Distribute transport and discount proportionally
    const transportCost = parseFloat(offer.Transport_Cost) || 0;
    const discountAmount = offer.Onsite_Assembly ? (parseFloat(offer.Onsite_Discount) || 0) : 0;
    
    products.forEach(product => {
      const proportion = subtotal > 0 ? (parseFloat(product.Total_Price) || 0) / subtotal : 0;
      
      const transportShare = transportCost * proportion;
      const discountShare = discountAmount * proportion;
      
      // Update product row
      const productRowIndex = findRowByValue(productsSheet, 1, product.ID);
      if (productRowIndex !== -1) {
        productsSheet.getRange(productRowIndex, 17).setValue(transportShare); // Transport_Share
        productsSheet.getRange(productRowIndex, 18).setValue(discountShare);  // Discount_Share
      }
    });
    
    // Calculate total
    const total = subtotal + transportCost - discountAmount;
    
    // Update offer
    offerSheet.getRange(offerRowIndex, 10).setValue(subtotal); // Subtotal
    offerSheet.getRange(offerRowIndex, 11).setValue(total);    // Total
    
    return { subtotal, total, transportCost, discountAmount };
  } catch (e) {
    console.error('Error calculating offer totals: ' + e.message);
    return null;
  }
}

// ============================================
// NEW: Create Offer With Full Product Data
// ============================================

function createOfferWithProducts(offerData) {
  try {
    const ss = getSpreadsheet();
    const offersSheet = ss.getSheetByName(SHEET_NAMES.OFFERS);
    const offerProductsSheet = ss.getSheetByName(SHEET_NAMES.OFFER_PRODUCTS);
    const offerExtrasSheet = ss.getSheetByName(SHEET_NAMES.OFFER_EXTRAS);
    
    // Validate
    if (!offerData.Project_ID) {
      return errorResponse('Project ID je obavezan');
    }
    
    const includedProducts = (offerData.products || []).filter(p => p.Included);
    if (includedProducts.length === 0) {
      return errorResponse('Označite barem jedan proizvod');
    }
    
    // Create new offer
    const offerId = generateUUID();
    const offerNumber = generateOfferNumber();
    
    // Calculate subtotal
    let subtotal = 0;
    includedProducts.forEach(p => {
      const materialCost = parseFloat(p.Material_Cost) || 0;
      const margin = parseFloat(p.Margin) || 0;
      const extrasTotal = (p.Extras || []).reduce((sum, e) => sum + (parseFloat(e.total) || 0), 0);
      const quantity = parseFloat(p.Quantity) || 1;
      subtotal += (materialCost + margin + extrasTotal) * quantity;
    });
    
    const transportCost = parseFloat(offerData.Transport_Cost) || 0;
    const discount = offerData.Onsite_Assembly ? (parseFloat(offerData.Onsite_Discount) || 0) : 0;
    const total = subtotal + transportCost - discount;
    
    // Parse valid until date
    let validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (offerData.Valid_Until) {
      validUntil = new Date(offerData.Valid_Until);
    }
    
    const offer = {
      Offer_ID: offerId,
      Project_ID: offerData.Project_ID,
      Offer_Number: offerNumber,
      Created_Date: new Date(),
      Valid_Until: validUntil,
      Status: 'Nacrt',
      Transport_Cost: transportCost,
      Onsite_Assembly: offerData.Onsite_Assembly || false,
      Onsite_Discount: offerData.Onsite_Discount || 0,
      Subtotal: subtotal,
      Total: total,
      Notes: offerData.Notes || '',
      Accepted_Date: ''
    };
    
    const offerRow = objectToRow(SHEET_HEADERS.OFFERS, offer);
    offersSheet.appendRow(offerRow);
    
    // Add products
    offerData.products.forEach(product => {
      const materialCost = parseFloat(product.Material_Cost) || 0;
      const margin = parseFloat(product.Margin) || 0;
      const extrasTotal = (product.Extras || []).reduce((sum, e) => sum + (parseFloat(e.total) || 0), 0);
      const quantity = parseFloat(product.Quantity) || 1;
      const productTotal = (materialCost + margin + extrasTotal) * quantity;
      
      const offerProductData = {
        ID: generateUUID(),
        Offer_ID: offerId,
        Product_ID: product.Product_ID,
        Product_Name: product.Product_Name,
        Quantity: quantity,
        Included: product.Included === true,
        Material_Cost: materialCost,
        Margin: margin,
        Margin_Type: 'Fixed',
        LED_Meters: 0,
        LED_Price: 0,
        LED_Total: 0,
        Grouting: false,
        Grouting_Price: 0,
        Sink_Faucet: false,
        Sink_Faucet_Price: 0,
        Transport_Share: 0,
        Discount_Share: 0,
        Selling_Price: materialCost + margin + extrasTotal,
        Total_Price: productTotal
      };
      
      const productRow = objectToRow(SHEET_HEADERS.OFFER_PRODUCTS, offerProductData);
      offerProductsSheet.appendRow(productRow);
      
      // Add extras for this product
      (product.Extras || []).forEach(extra => {
        const extraData = {
          ID: generateUUID(),
          Offer_Product_ID: offerProductData.ID,
          Name: extra.name,
          Quantity: extra.qty,
          Unit: extra.unit,
          Unit_Price: extra.price,
          Total: extra.total,
          Notes: extra.note || ''
        };
        
        const extraRow = objectToRow(SHEET_HEADERS.OFFER_EXTRAS, extraData);
        offerExtrasSheet.appendRow(extraRow);
      });
    });
    
    return successResponse({ 
      Offer_ID: offerId, 
      Offer_Number: offerNumber,
      Total: total
    }, 'Ponuda kreirana');
    
  } catch (e) {
    return handleError(e, 'createOfferWithProducts');
  }
}
