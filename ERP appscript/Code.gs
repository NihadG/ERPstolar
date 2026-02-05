/**
 * Furniture Production Tracking App
 * Main entry point and configuration
 */

// ============================================
// CONFIGURATION
// ============================================

const SPREADSHEET_ID = '1n2aq0WO5WVCTV-_BGIShCt95xHgSEKjuu7qc7ZSrCY8'; // User's spreadsheet

const SHEET_NAMES = {
  PROJECTS: 'Projects',
  PRODUCTS: 'Products',
  MATERIALS_DB: 'Materials_Database',
  PRODUCT_MATERIALS: 'Product_Materials',
  GLASS_ITEMS: 'Glass_Items',
  ALU_DOOR_ITEMS: 'Alu_Door_Items',
  OFFERS: 'Offers',
  OFFER_PRODUCTS: 'Offer_Products',
  OFFER_EXTRAS: 'Offer_Product_Extras',
  ORDERS: 'Orders',
  ORDER_ITEMS: 'Order_Items',
  SUPPLIERS: 'Suppliers',
  WORKERS: 'Workers',
  TASKS: 'Tasks'
};

const SHEET_HEADERS = {
  PROJECTS: ['Project_ID', 'Client_Name', 'Client_Phone', 'Client_Email', 'Address', 'Notes', 'Status', 'Production_Mode', 'Created_Date', 'Deadline'],
  PRODUCTS: ['Product_ID', 'Project_ID', 'Name', 'Height', 'Width', 'Depth', 'Quantity', 'Status', 'Material_Cost', 'Notes'],
  MATERIALS_DB: ['Material_ID', 'Name', 'Category', 'Unit', 'Default_Supplier', 'Default_Unit_Price', 'Description', 'Is_Glass', 'Is_Alu_Door'],
  GLASS_ITEMS: ['ID', 'Product_Material_ID', 'Order_ID', 'Qty', 'Width', 'Height', 'Area_M2', 'Edge_Processing', 'Note', 'Status'],
  ALU_DOOR_ITEMS: ['ID', 'Product_Material_ID', 'Order_ID', 'Qty', 'Width', 'Height', 'Frame_Type', 'Glass_Type', 'Frame_Color', 'Hinge_Color', 'Hinge_Type', 'Hinge_Side', 'Hinge_Layout', 'Hinge_Positions', 'Integrated_Handle', 'Area_M2', 'Unit_Price', 'Total_Price', 'Note', 'Status'],
  PRODUCT_MATERIALS: ['ID', 'Product_ID', 'Material_ID', 'Material_Name', 'Quantity', 'Unit', 'Unit_Price', 'Total_Price', 'Status', 'Supplier', 'Order_ID'],
  OFFERS: ['Offer_ID', 'Project_ID', 'Offer_Number', 'Created_Date', 'Valid_Until', 'Status', 'Transport_Cost', 'Onsite_Assembly', 'Onsite_Discount', 'Subtotal', 'Total', 'Notes', 'Accepted_Date'],
  OFFER_PRODUCTS: ['ID', 'Offer_ID', 'Product_ID', 'Product_Name', 'Quantity', 'Included', 'Material_Cost', 'Margin', 'Margin_Type', 'LED_Meters', 'LED_Price', 'LED_Total', 'Grouting', 'Grouting_Price', 'Sink_Faucet', 'Sink_Faucet_Price', 'Transport_Share', 'Discount_Share', 'Selling_Price', 'Total_Price'],
  OFFER_EXTRAS: ['ID', 'Offer_Product_ID', 'Name', 'Quantity', 'Unit', 'Unit_Price', 'Total'],
  ORDERS: ['Order_ID', 'Order_Number', 'Supplier_ID', 'Supplier_Name', 'Order_Date', 'Status', 'Expected_Delivery', 'Total_Amount', 'Notes'],
  ORDER_ITEMS: ['ID', 'Order_ID', 'Product_Material_ID', 'Product_ID', 'Product_Name', 'Project_ID', 'Material_Name', 'Quantity', 'Unit', 'Expected_Price', 'Actual_Price', 'Received_Quantity', 'Status'],
  SUPPLIERS: ['Supplier_ID', 'Name', 'Contact_Person', 'Phone', 'Email', 'Address', 'Categories'],
  WORKERS: ['Worker_ID', 'Name', 'Role', 'Phone', 'Status'],
  TASKS: ['Task_ID', 'Project_ID', 'Product_ID', 'Worker_ID', 'Task_Type', 'Description', 'Status', 'Due_Date', 'Completed_Date']
};

const PROJECT_STATUSES = ['Nacrt', 'Ponuđeno', 'Odobreno', 'U proizvodnji', 'Sklapanje', 'Montaža', 'Završeno', 'Otkazano'];
const PRODUCT_STATUSES = ['Na čekanju', 'Materijali naručeni', 'Materijali spremni', 'Rezanje', 'Kantiranje', 'Bušenje', 'Sklapanje', 'Spremno', 'Instalirano'];
const MATERIAL_STATUSES = ['Nije naručeno', 'Naručeno', 'Primljeno', 'U upotrebi', 'Instalirano'];
const OFFER_STATUSES = ['Nacrt', 'Poslano', 'Prihvaćeno', 'Odbijeno', 'Isteklo', 'Revidirano'];
const ORDER_STATUSES = ['Nacrt', 'Poslano', 'Potvrđeno', 'Isporučeno', 'Primljeno', 'Djelomično'];
const MATERIAL_CATEGORIES = ['Ploča', 'Kanttraka', 'Okovi', 'Vijci', 'Šarke', 'Ladičari', 'Ručke', 'LED', 'Staklo', 'Alu vrata', 'Ostalo'];
const PRODUCTION_MODES = ['PreCut', 'InHouse'];
const WORKER_ROLES = ['Rezač', 'Kantiranje', 'Bušenje', 'Montaža', 'Instalacija', 'Opći'];

// ============================================
// WEB APP ENTRY POINT
// ============================================

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Furniture Production Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================
// OPTIMIZED: GET ALL DATA IN ONE CALL
// ============================================

function getAllData() {
  try {
    const ss = getSpreadsheet();
    
    // Helper to convert sheet data to objects with date serialization
    function sheetToObjects(sheetName, headers) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() <= 1) return [];
      
      const data = sheet.getDataRange().getValues();
      return data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => {
          let value = row[i];
          // Convert Date objects to ISO strings
          if (value instanceof Date) {
            value = value.toISOString();
          }
          obj[h] = value;
        });
        return obj;
      });
    }
    
    // Load all data in parallel (single spreadsheet access)
    const projects = sheetToObjects(SHEET_NAMES.PROJECTS, SHEET_HEADERS.PROJECTS);
    const products = sheetToObjects(SHEET_NAMES.PRODUCTS, SHEET_HEADERS.PRODUCTS);
    const materials = sheetToObjects(SHEET_NAMES.MATERIALS_DB, SHEET_HEADERS.MATERIALS_DB);
    const suppliers = sheetToObjects(SHEET_NAMES.SUPPLIERS, SHEET_HEADERS.SUPPLIERS);
    const workers = sheetToObjects(SHEET_NAMES.WORKERS, SHEET_HEADERS.WORKERS);
    const offers = sheetToObjects(SHEET_NAMES.OFFERS, SHEET_HEADERS.OFFERS);
    const orders = sheetToObjects(SHEET_NAMES.ORDERS, SHEET_HEADERS.ORDERS);
    const productMaterials = sheetToObjects(SHEET_NAMES.PRODUCT_MATERIALS, SHEET_HEADERS.PRODUCT_MATERIALS);
    const orderItems = sheetToObjects(SHEET_NAMES.ORDER_ITEMS, SHEET_HEADERS.ORDER_ITEMS);
    const glassItems = sheetToObjects(SHEET_NAMES.GLASS_ITEMS, SHEET_HEADERS.GLASS_ITEMS);
    const aluDoorItems = sheetToObjects(SHEET_NAMES.ALU_DOOR_ITEMS, SHEET_HEADERS.ALU_DOOR_ITEMS);
    
    // Attach glass items and alu door items to product materials
    productMaterials.forEach(pm => {
      pm.glassItems = glassItems.filter(gi => gi.Product_Material_ID === pm.ID);
      pm.aluDoorItems = aluDoorItems.filter(adi => adi.Product_Material_ID === pm.ID);
    });
    
    // Attach products to projects (client-side can now skip individual calls)
    projects.forEach(project => {
      project.products = products.filter(p => p.Project_ID === project.Project_ID);
      
      // Attach materials to each product
      project.products.forEach(product => {
        product.materials = productMaterials.filter(m => m.Product_ID === product.Product_ID);
      });
    });
    
    // Add project info to offers
    offers.forEach(offer => {
      const project = projects.find(p => p.Project_ID === offer.Project_ID);
      if (project) {
        offer.Client_Name = project.Client_Name;
      }
    });
    
    // Attach items to orders
    orders.forEach(order => {
      order.items = orderItems.filter(item => item.Order_ID === order.Order_ID);
    });
    
    return {
      projects,
      products,
      materials,
      suppliers,
      workers,
      offers,
      orders,
      productMaterials,
      glassItems,
      aluDoorItems
    };
  } catch (e) {
    console.error('getAllData error:', e.message);
    return {
      projects: [],
      products: [],
      materials: [],
      suppliers: [],
      workers: [],
      offers: [],
      orders: [],
      productMaterials: []
    };
  }
}

// ============================================
// SPREADSHEET MANAGEMENT
// ============================================

function getSpreadsheet() {
  let ss;
  
  if (SPREADSHEET_ID && SPREADSHEET_ID.length > 0) {
    try {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {
      Logger.log('Could not open spreadsheet by ID, creating new one: ' + e.message);
      ss = createNewSpreadsheet();
    }
  } else {
    // Try to find existing or create new
    const files = DriveApp.getFilesByName('Furniture Production DB');
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = createNewSpreadsheet();
    }
  }
  
  return ss;
}

function createNewSpreadsheet() {
  const ss = SpreadsheetApp.create('Furniture Production DB');
  Logger.log('Created new spreadsheet: ' + ss.getId());
  initializeSheets(ss);
  return ss;
}

function initializeSheets(ss) {
  if (!ss) {
    ss = getSpreadsheet();
  }
  
  // Create all sheets with headers
  for (const [key, name] of Object.entries(SHEET_NAMES)) {
    let sheet = ss.getSheetByName(name);
    
    if (!sheet) {
      sheet = ss.insertSheet(name);
      const headers = SHEET_HEADERS[key];
      if (headers && headers.length > 0) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    }
  }
  
  // Remove default Sheet1 if exists and empty
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {
      // Ignore if can't delete
    }
  }
  
  // Add sample materials to database if empty
  const materialsSheet = ss.getSheetByName(SHEET_NAMES.MATERIALS_DB);
  if (materialsSheet.getLastRow() <= 1) {
    addSampleMaterials(materialsSheet);
  }
  
  return ss;
}

function addSampleMaterials(sheet) {
  const sampleMaterials = [
    [generateUUID(), 'MDF 18mm Bijela', 'Ploča', 'm²', '', 25, 'MDF ploča 18mm bijela boja'],
    [generateUUID(), 'MDF 18mm Hrast', 'Ploča', 'm²', '', 30, 'MDF ploča 18mm dekor hrast'],
    [generateUUID(), 'Iverica 18mm', 'Ploča', 'm²', '', 15, 'Iverica 18mm'],
    [generateUUID(), 'Kanttraka Bijela 22mm', 'Kanttraka', 'm', '', 1.5, 'ABS kanttraka bijela 22mm'],
    [generateUUID(), 'Kanttraka Hrast 22mm', 'Kanttraka', 'm', '', 2, 'ABS kanttraka hrast 22mm'],
    [generateUUID(), 'Šarka Blum 110°', 'Šarke', 'kom', '', 3.5, 'Blum clip-on šarka 110°'],
    [generateUUID(), 'Ladičar Blum 500mm', 'Ladičari', 'set', '', 45, 'Blum Tandembox 500mm'],
    [generateUUID(), 'Ručka Moderna 128mm', 'Ručke', 'kom', '', 8, 'Aluminijska ručka 128mm'],
    [generateUUID(), 'LED Traka 12V', 'LED', 'm', '', 15, 'LED traka 12V topla bijela'],
    [generateUUID(), 'Vijci 4x30', 'Vijci', 'kom', '', 0.05, 'Vijci za drvo 4x30mm'],
    [generateUUID(), 'Tipla 8mm', 'Okovi', 'kom', '', 0.1, 'Drvena tipla 8mm'],
    [generateUUID(), 'Ekscentar 15mm', 'Okovi', 'kom', '', 0.3, 'Ekscentar za spajanje 15mm']
  ];
  
  sheet.getRange(2, 1, sampleMaterials.length, sampleMaterials[0].length).setValues(sampleMaterials);
}

// ============================================
// TEST FUNCTION - Run this to debug data loading
// ============================================

function testDataLoading() {
  try {
    Logger.log('=== STARTING DATA LOAD TEST ===');
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    Logger.log('Spreadsheet opened: ' + ss.getName());
    
    // Test Projects sheet
    const projectsSheet = ss.getSheetByName('Projects');
    Logger.log('Projects sheet exists: ' + !!projectsSheet);
    
    if (projectsSheet) {
      Logger.log('Projects last row: ' + projectsSheet.getLastRow());
      const projectData = projectsSheet.getDataRange().getValues();
      Logger.log('Projects data rows: ' + (projectData.length - 1));
      
      if (projectData.length > 1) {
        Logger.log('First project row: ' + JSON.stringify(projectData[1]));
        Logger.log('First project ID: ' + projectData[1][0]);
      }
    }
    
    // Test Products sheet
    const productsSheet = ss.getSheetByName('Products');
    Logger.log('Products sheet exists: ' + !!productsSheet);
    
    if (productsSheet) {
      Logger.log('Products last row: ' + productsSheet.getLastRow());
      const productData = productsSheet.getDataRange().getValues();
      Logger.log('Products data rows: ' + (productData.length - 1));
      
      if (productData.length > 1) {
        Logger.log('First product row: ' + JSON.stringify(productData[1]));
        Logger.log('First product Project_ID: ' + productData[1][1]);
      }
    }
    
    // Test calling getProjects directly
    Logger.log('=== CALLING getProjects() ===');
    const projects = getProjects();
    Logger.log('getProjects returned: ' + projects.length + ' projects');
    
    if (projects.length > 0) {
      Logger.log('First project: ' + JSON.stringify(projects[0]));
    }
    
    Logger.log('=== TEST COMPLETE ===');
    return 'Test complete - check Logs (View > Logs)';
    
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('STACK: ' + e.stack);
    return 'Error: ' + e.message;
  }
}

// ============================================
// INITIALIZATION CHECK
// ============================================

function checkAndInitialize() {
  try {
    const ss = getSpreadsheet();
    initializeSheets(ss);
    return { success: true, spreadsheetId: ss.getId() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// FULL DATABASE SETUP WITH SAMPLE DATA
// Run this function manually to initialize everything!
// ============================================

function setupDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Delete all existing sheets except first one
  const sheets = ss.getSheets();
  for (let i = sheets.length - 1; i > 0; i--) {
    ss.deleteSheet(sheets[i]);
  }
  
  // Rename first sheet temporarily
  sheets[0].setName('_temp');
  
  // Create all sheets with headers
  for (const [key, name] of Object.entries(SHEET_NAMES)) {
    const sheet = ss.insertSheet(name);
    const headers = SHEET_HEADERS[key];
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.getRange(1, 1, 1, headers.length).setBackground('#e8e8ed');
      sheet.setFrozenRows(1);
    }
  }
  
  // Delete temp sheet
  const tempSheet = ss.getSheetByName('_temp');
  if (tempSheet) {
    ss.deleteSheet(tempSheet);
  }
  
  // Add sample data to all sheets
  addAllSampleData(ss);
  
  return 'Database setup complete!';
}

function addAllSampleData(ss) {
  // ========== SUPPLIERS ==========
  const suppliersSheet = ss.getSheetByName(SHEET_NAMES.SUPPLIERS);
  const suppliers = [
    [Utilities.getUuid(), 'Panel Plus d.o.o.', 'Marko Marković', '033-123-456', 'info@panelplus.ba', 'Sarajevo, Industrijska 15', 'Ploča,Kanttraka'],
    [Utilities.getUuid(), 'Okovi Trade', 'Ana Anić', '033-234-567', 'prodaja@okovitrade.ba', 'Sarajevo, Braće Begić 8', 'Okovi,Šarke,Ladičari,Ručke'],
    [Utilities.getUuid(), 'LED Solutions', 'Ivo Ivić', '033-345-678', 'led@solutions.ba', 'Mostar, Bulevar 22', 'LED'],
    [Utilities.getUuid(), 'Drvo Centar', 'Hasan Hasanović', '033-456-789', 'nabava@drvocentar.ba', 'Zenica, Masarykova 5', 'Ploča,Vijci,Okovi']
  ];
  suppliersSheet.getRange(2, 1, suppliers.length, suppliers[0].length).setValues(suppliers);
  
  // ========== WORKERS ==========
  const workersSheet = ss.getSheetByName(SHEET_NAMES.WORKERS);
  const workers = [
    [Utilities.getUuid(), 'Emir Hodžić', 'Montaža', '061-111-222', 'Dostupan'],
    [Utilities.getUuid(), 'Senad Mujić', 'Rezač', '061-222-333', 'Dostupan'],
    [Utilities.getUuid(), 'Adnan Čaušević', 'Kantiranje', '061-333-444', 'Dostupan'],
    [Utilities.getUuid(), 'Mirza Begović', 'Instalacija', '061-444-555', 'Dostupan'],
    [Utilities.getUuid(), 'Dino Smajlović', 'Opći', '061-555-666', 'Dostupan']
  ];
  workersSheet.getRange(2, 1, workers.length, workers[0].length).setValues(workers);
  
  // ========== MATERIALS DATABASE ==========
  const materialsSheet = ss.getSheetByName(SHEET_NAMES.MATERIALS_DB);
  const materials = [
    // Ploče
    [Utilities.getUuid(), 'MDF 18mm Bijela', 'Ploča', 'm²', 'Panel Plus d.o.o.', 25, 'MDF ploča 18mm bijela mat'],
    [Utilities.getUuid(), 'MDF 18mm Hrast', 'Ploča', 'm²', 'Panel Plus d.o.o.', 30, 'MDF ploča 18mm dekor hrast'],
    [Utilities.getUuid(), 'MDF 18mm Antracit', 'Ploča', 'm²', 'Panel Plus d.o.o.', 32, 'MDF ploča 18mm antracit mat'],
    [Utilities.getUuid(), 'MDF 18mm Orah', 'Ploča', 'm²', 'Panel Plus d.o.o.', 35, 'MDF ploča 18mm američkog oraha'],
    [Utilities.getUuid(), 'Iverica 18mm Bijela', 'Ploča', 'm²', 'Drvo Centar', 15, 'Iverica 18mm bijela melamin'],
    [Utilities.getUuid(), 'Iverica 18mm Bukva', 'Ploča', 'm²', 'Drvo Centar', 18, 'Iverica 18mm dekor bukva'],
    [Utilities.getUuid(), 'HPL Radna Ploča 38mm', 'Ploča', 'm', 'Panel Plus d.o.o.', 85, 'HPL radna ploča 38mm razni dekori'],
    
    // Kanttrake
    [Utilities.getUuid(), 'Kanttraka Bijela 22mm', 'Kanttraka', 'm', 'Panel Plus d.o.o.', 1.5, 'ABS kanttraka bijela 22x0.8mm'],
    [Utilities.getUuid(), 'Kanttraka Bijela 42mm', 'Kanttraka', 'm', 'Panel Plus d.o.o.', 2, 'ABS kanttraka bijela 42x2mm'],
    [Utilities.getUuid(), 'Kanttraka Hrast 22mm', 'Kanttraka', 'm', 'Panel Plus d.o.o.', 2, 'ABS kanttraka hrast 22x0.8mm'],
    [Utilities.getUuid(), 'Kanttraka Antracit 22mm', 'Kanttraka', 'm', 'Panel Plus d.o.o.', 2.5, 'ABS kanttraka antracit 22x0.8mm'],
    
    // Šarke
    [Utilities.getUuid(), 'Šarka Blum 110°', 'Šarke', 'kom', 'Okovi Trade', 3.5, 'Blum clip-on šarka 110°'],
    [Utilities.getUuid(), 'Šarka Blum 155°', 'Šarke', 'kom', 'Okovi Trade', 5.5, 'Blum clip-on šarka 155° za kutne elemente'],
    [Utilities.getUuid(), 'Šarka sa amortizerom', 'Šarke', 'kom', 'Okovi Trade', 4, 'Šarka sa soft-close amortizerom'],
    
    // Ladičari
    [Utilities.getUuid(), 'Ladičar Blum 300mm', 'Ladičari', 'set', 'Okovi Trade', 35, 'Blum Tandembox 300mm'],
    [Utilities.getUuid(), 'Ladičar Blum 450mm', 'Ladičari', 'set', 'Okovi Trade', 40, 'Blum Tandembox 450mm'],
    [Utilities.getUuid(), 'Ladičar Blum 500mm', 'Ladičari', 'set', 'Okovi Trade', 45, 'Blum Tandembox 500mm'],
    [Utilities.getUuid(), 'Ladičar Blum 600mm', 'Ladičari', 'set', 'Okovi Trade', 52, 'Blum Tandembox 600mm'],
    
    // Ručke
    [Utilities.getUuid(), 'Ručka Moderna 128mm', 'Ručke', 'kom', 'Okovi Trade', 8, 'Aluminijska ručka 128mm'],
    [Utilities.getUuid(), 'Ručka Moderna 192mm', 'Ručke', 'kom', 'Okovi Trade', 12, 'Aluminijska ručka 192mm'],
    [Utilities.getUuid(), 'Ručka Shell 64mm', 'Ručke', 'kom', 'Okovi Trade', 6, 'Ukopana ručka 64mm crna'],
    [Utilities.getUuid(), 'Profil Gola bezručna', 'Ručke', 'm', 'Okovi Trade', 15, 'Gornji gola profil za bezručno otvaranje'],
    
    // LED
    [Utilities.getUuid(), 'LED Traka 12V Topla', 'LED', 'm', 'LED Solutions', 15, 'LED traka 12V topla bijela 3000K'],
    [Utilities.getUuid(), 'LED Traka 12V Neutralna', 'LED', 'm', 'LED Solutions', 15, 'LED traka 12V neutralna bijela 4000K'],
    [Utilities.getUuid(), 'LED Profil Aluminij', 'LED', 'm', 'LED Solutions', 8, 'Aluminijski profil za LED traku'],
    [Utilities.getUuid(), 'LED Trafo 60W', 'LED', 'kom', 'LED Solutions', 25, 'LED napajanje 12V 60W'],
    [Utilities.getUuid(), 'LED Senzor Vrata', 'LED', 'kom', 'LED Solutions', 12, 'Senzor za paljenje LED prilikom otvaranja'],
    
    // Okovi
    [Utilities.getUuid(), 'Ekscentar 15mm', 'Okovi', 'kom', 'Drvo Centar', 0.3, 'Ekscentar za spajanje 15mm'],
    [Utilities.getUuid(), 'Tipla Drvena 8mm', 'Okovi', 'kom', 'Drvo Centar', 0.08, 'Drvena tipla 8x30mm'],
    [Utilities.getUuid(), 'Podnica za ormar', 'Okovi', 'set', 'Okovi Trade', 5, 'Podnica za ormar sa čavlićima'],
    [Utilities.getUuid(), 'Polica nosač', 'Okovi', 'kom', 'Okovi Trade', 0.5, 'Metalni nosač police 5mm'],
    [Utilities.getUuid(), 'Podnožje PVC 100mm', 'Okovi', 'm', 'Okovi Trade', 4, 'PVC podnožje 100mm bijelo'],
    [Utilities.getUuid(), 'Amortizer za vrata', 'Okovi', 'kom', 'Okovi Trade', 3, 'Soft-close amortizer za vrata'],
    [Utilities.getUuid(), 'Lift sistem Aventos HK', 'Okovi', 'set', 'Okovi Trade', 85, 'Blum Aventos HK-S lift sistem'],
    
    // Vijci
    [Utilities.getUuid(), 'Vijci 3.5x16', 'Vijci', 'kom', 'Drvo Centar', 0.02, 'Vijci za drvo 3.5x16mm'],
    [Utilities.getUuid(), 'Vijci 4x30', 'Vijci', 'kom', 'Drvo Centar', 0.03, 'Vijci za drvo 4x30mm'],
    [Utilities.getUuid(), 'Vijci 4x50', 'Vijci', 'kom', 'Drvo Centar', 0.04, 'Vijci za drvo 4x50mm'],
    [Utilities.getUuid(), 'Konfirmat 5x50', 'Vijci', 'kom', 'Drvo Centar', 0.08, 'Konfirmat vijak 5x50mm'],
    
    // Ostalo
    [Utilities.getUuid(), 'Silikonski kit Bijeli', 'Ostalo', 'kom', 'Drvo Centar', 5, 'Sanitarni silikon bijeli 280ml'],
    [Utilities.getUuid(), 'Krpena traka', 'Ostalo', 'kom', 'Drvo Centar', 3, 'Krpena zaštitna traka 50m'],
    [Utilities.getUuid(), 'Ljepilo za drvo D3', 'Ostalo', 'kom', 'Drvo Centar', 8, 'Ljepilo za drvo D3 750ml']
  ];
  materialsSheet.getRange(2, 1, materials.length, materials[0].length).setValues(materials);
  
  // ========== PROJECTS ==========
  const projectsSheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
  const project1Id = Utilities.getUuid();
  const project2Id = Utilities.getUuid();
  const project3Id = Utilities.getUuid();
  
  const projects = [
    [project1Id, 'Marko Marković', '061-123-456', 'marko@email.com', 'Sarajevo, Titova 15', 'Kompletna kuhinja sa aparatima', 'U proizvodnji', 'PreCut', new Date(), new Date(Date.now() + 30*24*60*60*1000)],
    [project2Id, 'Ana Anić', '062-234-567', 'ana@email.com', 'Mostar, Bulevar 22', 'Spavaća soba - ormar i noćni ormarići', 'Odobreno', 'InHouse', new Date(), new Date(Date.now() + 45*24*60*60*1000)],
    [project3Id, 'Haris Hadžić', '063-345-678', 'haris@email.com', 'Zenica, Londža 8', 'Dnevni boravak - TV komoda i police', 'Nacrt', 'PreCut', new Date(), new Date(Date.now() + 60*24*60*60*1000)]
  ];
  projectsSheet.getRange(2, 1, projects.length, projects[0].length).setValues(projects);
  
  // ========== PRODUCTS ==========
  const productsSheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
  const prod1Id = Utilities.getUuid();
  const prod2Id = Utilities.getUuid();
  const prod3Id = Utilities.getUuid();
  const prod4Id = Utilities.getUuid();
  const prod5Id = Utilities.getUuid();
  const prod6Id = Utilities.getUuid();
  const prod7Id = Utilities.getUuid();
  
  const products = [
    // Project 1 - Kuhinja
    [prod1Id, project1Id, 'Donji kuhinjski element 80cm', 720, 800, 560, 1, 'Materijali naručeni', 185, 'Sa 2 ladice Blum'],
    [prod2Id, project1Id, 'Gornji kuhinjski element 60cm', 720, 600, 320, 2, 'Na čekanju', 95, 'Sa vratima i policom'],
    [prod3Id, project1Id, 'Visoki element za pećnicu', 2100, 600, 560, 1, 'Na čekanju', 280, 'Sa ugradnom pećnicom'],
    [prod4Id, project1Id, 'Radna ploča', 40, 3000, 600, 1, 'Materijali naručeni', 255, 'HPL radna ploča sa prolazom za sudoper'],
    
    // Project 2 - Spavaća
    [prod5Id, project2Id, 'Klizni ormar 250cm', 2400, 2500, 600, 1, 'Na čekanju', 650, 'Sa 3 klizna vrata i LED osvjetljenjem'],
    [prod6Id, project2Id, 'Noćni ormarić', 450, 400, 400, 2, 'Na čekanju', 75, 'Sa jednom ladicom'],
    
    // Project 3 - Dnevni
    [prod7Id, project3Id, 'TV komoda 200cm', 500, 2000, 450, 1, 'Na čekanju', 320, 'Sa LED rasvjetom ispod']
  ];
  productsSheet.getRange(2, 1, products.length, products[0].length).setValues(products);
  
  // ========== PRODUCT MATERIALS ==========
  const productMaterialsSheet = ss.getSheetByName(SHEET_NAMES.PRODUCT_MATERIALS);
  const productMaterials = [
    // Donji element 80cm (prod1Id)
    [Utilities.getUuid(), prod1Id, '', 'MDF 18mm Bijela', 2.5, 'm²', 25, 62.5, 'Naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod1Id, '', 'Kanttraka Bijela 22mm', 8, 'm', 1.5, 12, 'Naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod1Id, '', 'Ladičar Blum 500mm', 2, 'set', 45, 90, 'Naručeno', 'Okovi Trade', ''],
    [Utilities.getUuid(), prod1Id, '', 'Ručka Moderna 128mm', 2, 'kom', 8, 16, 'Nije naručeno', 'Okovi Trade', ''],
    [Utilities.getUuid(), prod1Id, '', 'Vijci 4x30', 50, 'kom', 0.03, 1.5, 'Nije naručeno', 'Drvo Centar', ''],
    
    // Gornji element 60cm (prod2Id)
    [Utilities.getUuid(), prod2Id, '', 'MDF 18mm Bijela', 1.2, 'm²', 25, 30, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod2Id, '', 'Kanttraka Bijela 22mm', 5, 'm', 1.5, 7.5, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod2Id, '', 'Šarka Blum 110°', 4, 'kom', 3.5, 14, 'Nije naručeno', 'Okovi Trade', ''],
    [Utilities.getUuid(), prod2Id, '', 'Lift sistem Aventos HK', 1, 'set', 85, 85, 'Nije naručeno', 'Okovi Trade', ''],
    
    // Radna ploča (prod4Id)
    [Utilities.getUuid(), prod4Id, '', 'HPL Radna Ploča 38mm', 3, 'm', 85, 255, 'Naručeno', 'Panel Plus d.o.o.', ''],
    
    // Klizni ormar (prod5Id)
    [Utilities.getUuid(), prod5Id, '', 'MDF 18mm Bijela', 12, 'm²', 25, 300, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod5Id, '', 'Kanttraka Bijela 42mm', 15, 'm', 2, 30, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod5Id, '', 'LED Traka 12V Topla', 6, 'm', 15, 90, 'Nije naručeno', 'LED Solutions', ''],
    [Utilities.getUuid(), prod5Id, '', 'LED Trafo 60W', 1, 'kom', 25, 25, 'Nije naručeno', 'LED Solutions', ''],
    [Utilities.getUuid(), prod5Id, '', 'Polica nosač', 24, 'kom', 0.5, 12, 'Nije naručeno', 'Okovi Trade', ''],
    
    // Noćni ormarić (prod6Id)
    [Utilities.getUuid(), prod6Id, '', 'MDF 18mm Hrast', 0.8, 'm²', 30, 24, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod6Id, '', 'Kanttraka Hrast 22mm', 3, 'm', 2, 6, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod6Id, '', 'Ladičar Blum 300mm', 1, 'set', 35, 35, 'Nije naručeno', 'Okovi Trade', ''],
    
    // TV komoda (prod7Id)
    [Utilities.getUuid(), prod7Id, '', 'MDF 18mm Antracit', 4, 'm²', 32, 128, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod7Id, '', 'Kanttraka Antracit 22mm', 12, 'm', 2.5, 30, 'Nije naručeno', 'Panel Plus d.o.o.', ''],
    [Utilities.getUuid(), prod7Id, '', 'LED Traka 12V Neutralna', 4, 'm', 15, 60, 'Nije naručeno', 'LED Solutions', ''],
    [Utilities.getUuid(), prod7Id, '', 'Profil Gola bezručna', 2, 'm', 15, 30, 'Nije naručeno', 'Okovi Trade', ''],
    [Utilities.getUuid(), prod7Id, '', 'Amortizer za vrata', 4, 'kom', 3, 12, 'Nije naručeno', 'Okovi Trade', '']
  ];
  productMaterialsSheet.getRange(2, 1, productMaterials.length, productMaterials[0].length).setValues(productMaterials);
  
  Logger.log('All sample data added successfully!');
}
