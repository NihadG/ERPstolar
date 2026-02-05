# Furniture Production Tracking Application

## Overview

Build a **Google Apps Script** web application for tracking panel furniture production. The application manages the complete workflow from quote creation, material ordering, assembly, to worker task delegation. It uses **Google Sheets** as the database backend.

---

## Tech Stack

- **Backend**: Google Apps Script (`.gs` files)
- **Frontend**: HTML, CSS, JavaScript (served via `HtmlService`)
- **Database**: Google Sheets (multiple sheets as tables)
- **Styling**: Clean, minimal Apple-style aesthetics

---

## Core Features

### 1. Production Modes

Each project must specify one of two production modes:

| Mode | Description |
|------|-------------|
| **Pre-Cut Materials** | All materials arrive pre-cut, edged, and drilled. Only assembly and installation required. |
| **In-House Processing** | Raw panels ordered. We handle: cutting, edge banding, drilling (hinges, screws, hardware), assembly, and installation. |

The selected mode affects:
- Available process steps
- Task delegation options
- Timeline calculations

---

## 2. Pricing System Architecture

### Core Pricing Principles

1. **Material Cost** = Sum of (material unit price × quantity) for all materials assigned to a product
2. **Product Base Price** = Material Cost (auto-calculated, read-only)
3. **Product Selling Price** = Material Cost + Margin + Extras (LED, services)
4. **Offer Total** = Sum of selected products' selling prices + Transport - On-site Discount

### Price Calculation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRICING FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  STEP 1: PRODUCT MATERIALS                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Material A: 2 m² × €25/m² = €50                                     │    │
│  │ Material B: 4 pcs × €3.50/pc = €14                                  │    │
│  │ Material C: 3 m × €2/m = €6                                         │    │
│  │ ─────────────────────────────────────────────                       │    │
│  │ MATERIAL COST (auto-calculated): €70                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              ↓                                               │
│  STEP 2: OFFER CREATION (per product)                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Material Cost: €70 (read-only, from Step 1)                         │    │
│  │ + Margin: €30 (user input, can be % or fixed)                       │    │
│  │ + LED: 2m × €15/m = €30 (optional, per product)                     │    │
│  │ + Grouting: €20 (optional, per product)                             │    │
│  │ + Sink Install: €50 (optional, per product)                         │    │
│  │ + Custom Extra: "Special Handle" 1 pc × €25 = €25                   │    │
│  │ ─────────────────────────────────────────────                       │    │
│  │ PRODUCT SELLING PRICE: €225                                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              ↓                                               │
│  STEP 3: OFFER TOTALS                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Product 1: €225 × qty 1 = €225                                      │    │
│  │ Product 2: €180 × qty 2 = €360                                      │    │
│  │ ─────────────────────────────────────────────                       │    │
│  │ Subtotal: €585                                                      │    │
│  │ + Transport: €100 (divided: P1=€38.46, P2=€61.54)                   │    │
│  │ - On-site Discount: €50 (divided: P1=€19.23, P2=€30.77)             │    │
│  │ ─────────────────────────────────────────────                       │    │
│  │ OFFER TOTAL: €635                                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Product Extras (Per Product)

Each product in an offer can have these optional extras:

| Extra | Fields | Description |
|-------|--------|-------------|
| LED | meters, price_per_meter | LED lighting strips |
| Grouting | price | Joint sealing with walls/surfaces |
| Sink/Faucet Install | price | Plumbing installation |
| Custom Extras | name, quantity, unit, unit_price | Any additional service/material |

### Transport & Discount Distribution

Transport cost and on-site assembly discount are **proportionally distributed** across all products based on their individual contribution to the subtotal.

```javascript
function distributeProportionally(totalAmount, products) {
  const subtotal = products.reduce((sum, p) => sum + p.sellingPrice * p.quantity, 0);
  return products.map(p => ({
    ...p,
    distributed: (p.sellingPrice * p.quantity / subtotal) * totalAmount
  }));
}
```

---

## 3. Database Structure (Google Sheets)

### `Projects`
| Column | Type | Description |
|--------|------|-------------|
| Project_ID | String (UUID) | Unique identifier |
| Client_Name | String | Customer name |
| Client_Phone | String | Contact phone |
| Client_Email | String | Contact email |
| Address | String | Delivery/installation address |
| Notes | Text | Additional notes |
| Status | Enum | See Status Automation section |
| Production_Mode | Enum | `PreCut` or `InHouse` |
| Created_Date | Date | Creation timestamp |
| Deadline | Date | Target completion date |

### `Products`
| Column | Type | Description |
|--------|------|-------------|
| Product_ID | String (UUID) | Unique identifier |
| Project_ID | String | Foreign key to Projects |
| Name | String | Product name (e.g., "Kitchen Upper Cabinet") |
| Height | Number | Height in mm |
| Width | Number | Width in mm |
| Depth | Number | Depth/thickness in mm |
| Quantity | Number | Number of units |
| Status | Enum | See Status Automation section |
| Material_Cost | Number | **Auto-calculated** from Product_Materials |
| Notes | Text | Product-specific notes |

### `Materials_Database` (Master Catalog)
| Column | Type | Description |
|--------|------|-------------|
| Material_ID | String (UUID) | Unique identifier |
| Name | String | Material name |
| Category | Enum | `Panel`, `Edge_Band`, `Hardware`, `Screw`, `Hinge`, `Drawer_System`, `Handle`, `LED`, `Other` |
| Unit | String | `pcs`, `m`, `m²`, `kg`, `set` |
| Default_Supplier | String | Preferred supplier |
| Default_Unit_Price | Number | Default cost per unit |
| Description | Text | Additional details |

### `Product_Materials` (Materials Used Per Product)
| Column | Type | Description |
|--------|------|-------------|
| ID | String (UUID) | Unique identifier |
| Product_ID | String | Foreign key to Products |
| Material_ID | String | Foreign key to Materials_Database |
| Material_Name | String | Denormalized for display |
| Quantity | Number | Amount needed for this product |
| Unit | String | Unit of measure |
| Unit_Price | Number | **Actual price** (can differ from default after ordering) |
| Total_Price | Number | Quantity × Unit_Price |
| Status | Enum | `Not Ordered`, `Ordered`, `Received`, `In Use`, `Installed` |
| Supplier | String | Actual supplier for this material |
| Order_ID | String | Reference to order (if ordered) |

### `Offers`
| Column | Type | Description |
|--------|------|-------------|
| Offer_ID | String (UUID) | Unique identifier |
| Project_ID | String | Foreign key to Projects |
| Offer_Number | String | Human-readable (e.g., "PON-2024-001") |
| Created_Date | Date | When offer was created |
| Valid_Until | Date | Offer expiration date |
| Status | Enum | `Draft`, `Sent`, `Accepted`, `Rejected`, `Expired`, `Revised` |
| Transport_Cost | Number | Total transport cost |
| Onsite_Assembly | Boolean | Client allows on-site assembly |
| Onsite_Discount | Number | Discount if on-site assembly |
| Subtotal | Number | Sum of all products |
| Total | Number | Subtotal + Transport - Discount |
| Notes | Text | Offer notes |
| PDF_URL | String | Link to generated PDF |
| Accepted_Date | Date | When client accepted (if accepted) |

### `Offer_Products` (Products Included in Offer)
| Column | Type | Description |
|--------|------|-------------|
| ID | String (UUID) | Unique identifier |
| Offer_ID | String | Foreign key to Offers |
| Product_ID | String | Foreign key to Products |
| Included | Boolean | Whether included in this offer |
| Material_Cost | Number | **Snapshot** of material cost at offer time |
| Margin | Number | Added margin (can be % or fixed amount) |
| Margin_Type | Enum | `Percentage` or `Fixed` |
| LED_Meters | Number | LED meters for this product |
| LED_Price_Per_Meter | Number | LED price per meter |
| LED_Total | Number | LED_Meters × LED_Price_Per_Meter |
| Grouting | Boolean | Grouting service included |
| Grouting_Price | Number | Grouting price |
| Sink_Faucet | Boolean | Sink/faucet installation included |
| Sink_Faucet_Price | Number | Installation price |
| Transport_Share | Number | Proportional transport cost share |
| Discount_Share | Number | Proportional discount share |
| Selling_Price | Number | Final selling price per unit |
| Total_Price | Number | Selling_Price × Quantity |

### `Offer_Product_Extras` (Custom Extras Per Product in Offer)
| Column | Type | Description |
|--------|------|-------------|
| ID | String (UUID) | Unique identifier |
| Offer_Product_ID | String | Foreign key to Offer_Products |
| Name | String | Extra name (e.g., "Special Handle") |
| Quantity | Number | Quantity |
| Unit | String | Unit of measure |
| Unit_Price | Number | Price per unit |
| Total | Number | Quantity × Unit_Price |

### `Orders` (Material Orders to Suppliers)
| Column | Type | Description |
|--------|------|-------------|
| Order_ID | String (UUID) | Unique identifier |
| Order_Number | String | Human-readable (e.g., "NAR-2024-001") |
| Supplier_ID | String | Foreign key to Suppliers |
| Supplier_Name | String | Denormalized for display |
| Order_Date | Date | When order was placed |
| Status | Enum | `Draft`, `Sent`, `Confirmed`, `Shipped`, `Received`, `Partial` |
| Expected_Delivery | Date | Expected delivery date |
| Total_Amount | Number | Order total |
| Actual_Amount | Number | Actual amount paid (may differ) |
| Notes | Text | Order notes |
| PDF_URL | String | Link to generated PDF |

### `Order_Items`
| Column | Type | Description |
|--------|------|-------------|
| ID | String (UUID) | Unique identifier |
| Order_ID | String | Foreign key to Orders |
| Product_Material_ID | String | Foreign key to Product_Materials |
| Product_ID | String | For reference (denormalized) |
| Product_Name | String | For reference (denormalized) |
| Project_ID | String | For reference (denormalized) |
| Material_Name | String | For reference (denormalized) |
| Quantity | Number | Quantity ordered |
| Unit | String | Unit of measure |
| Expected_Price | Number | Price at time of order |
| Actual_Price | Number | Real price from supplier (can update) |
| Received_Quantity | Number | How much was received |
| Status | Enum | `Pending`, `Received`, `Partial` |

### `Suppliers`
| Column | Type | Description |
|--------|------|-------------|
| Supplier_ID | String (UUID) | Unique identifier |
| Name | String | Supplier company name |
| Contact_Person | String | Contact name |
| Phone | String | Contact phone |
| Email | String | Contact email |
| Address | String | Supplier address |
| Categories | String | Comma-separated material categories they supply |

### `Workers`
| Column | Type | Description |
|--------|------|-------------|
| Worker_ID | String (UUID) | Unique identifier |
| Name | String | Worker full name |
| Role | Enum | `Cutter`, `Edge_Bander`, `Driller`, `Assembler`, `Installer`, `General` |
| Phone | String | Contact phone |
| Status | Enum | `Available`, `Assigned`, `On Leave` |

### `Tasks`
| Column | Type | Description |
|--------|------|-------------|
| Task_ID | String (UUID) | Unique identifier |
| Project_ID | String | Foreign key to Projects |
| Product_ID | String | Foreign key to Products (optional) |
| Worker_ID | String | Foreign key to Workers |
| Task_Type | Enum | `Cutting`, `Edge_Banding`, `Drilling`, `Assembly`, `Installation`, `Delivery` |
| Description | Text | Task details |
| Status | Enum | `Pending`, `In Progress`, `Completed` |
| Due_Date | Date | Target completion |
| Completed_Date | Date | Actual completion |

### `Profit_Tracking` (For analyzing changes post-offer)
| Column | Type | Description |
|--------|------|-------------|
| ID | String (UUID) | Unique identifier |
| Offer_ID | String | Foreign key to Offers |
| Product_ID | String | Foreign key to Products |
| Original_Material_Cost | Number | Material cost when offer was created |
| Current_Material_Cost | Number | Current material cost |
| Cost_Difference | Number | Current - Original |
| Original_Selling_Price | Number | Price in offer |
| Expected_Profit | Number | Original Selling - Original Material |
| Current_Profit | Number | Original Selling - Current Material |
| Profit_Change | Number | Current Profit - Expected Profit |
| Last_Updated | Date | Last recalculation |

---

## 4. Status Automation

### Project Statuses & Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROJECT STATUS FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐                                                    │
│   │  Draft  │ ← Initial state when project created               │
│   └────┬────┘                                                    │
│        │ [Offer Created]                                         │
│        ↓                                                         │
│   ┌──────────┐                                                   │
│   │ Quoted   │ ← Offer sent to client                            │
│   └────┬─────┘                                                   │
│        │ [Client Accepts Offer]                                  │
│        ↓                                                         │
│   ┌───────────┐                                                  │
│   │ Approved  │ ← Automatically when offer accepted              │
│   └────┬──────┘                                                  │
│        │ [Any Material Ordered]                                  │
│        ↓                                                         │
│   ┌───────────────┐                                              │
│   │ In Production │ ← Automatically when first order placed      │
│   └───────┬───────┘                                              │
│           │ [All Materials Received]                             │
│           ↓                                                      │
│   ┌──────────┐                                                   │
│   │ Assembly │ ← Automatically when all materials received       │
│   └────┬─────┘                                                   │
│        │ [All Products Ready]                                    │
│        ↓                                                         │
│   ┌──────────────┐                                               │
│   │ Installation │ ← When all products marked as Ready           │
│   └──────┬───────┘                                               │
│          │ [All Products Installed]                              │
│          ↓                                                       │
│   ┌───────────┐                                                  │
│   │ Completed │ ← When all products marked as Installed          │
│   └───────────┘                                                  │
│                                                                  │
│   ┌───────────┐                                                  │
│   │ Cancelled │ ← Can be set manually at any time                │
│   └───────────┘                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Product Statuses & Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRODUCT STATUS FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐                                                    │
│   │ Pending │ ← Initial state                                    │
│   └────┬────┘                                                    │
│        │ [Any material for this product ordered]                 │
│        ↓                                                         │
│   ┌───────────────────┐                                          │
│   │ Materials Ordered │ ← Automatically                          │
│   └─────────┬─────────┘                                          │
│             │ [All materials for this product received]          │
│             ↓                                                    │
│   ┌───────────────────┐                                          │
│   │ Materials Ready   │ ← Automatically                          │
│   └─────────┬─────────┘                                          │
│             │                                                    │
│     ┌───────┴───────┐                                            │
│     │ Production    │ (depends on Production Mode)               │
│     │ Mode?         │                                            │
│     └───────┬───────┘                                            │
│             │                                                    │
│   ┌─────────┴─────────┐                                          │
│   │                   │                                          │
│   ↓ (In-House)        ↓ (Pre-Cut)                                │
│ ┌─────────┐        ┌──────────┐                                  │
│ │ Cutting │        │ Assembly │                                  │
│ └────┬────┘        └────┬─────┘                                  │
│      ↓                  │                                        │
│ ┌─────────────┐         │                                        │
│ │ Edge Banding│         │                                        │
│ └──────┬──────┘         │                                        │
│        ↓                │                                        │
│ ┌──────────┐            │                                        │
│ │ Drilling │            │                                        │
│ └────┬─────┘            │                                        │
│      ↓                  │                                        │
│ ┌──────────┐            │                                        │
│ │ Assembly │←───────────┘                                        │
│ └────┬─────┘                                                     │
│      ↓                                                           │
│ ┌─────────┐                                                      │
│ │  Ready  │ ← Product fully assembled                            │
│ └────┬────┘                                                      │
│      ↓                                                           │
│ ┌───────────┐                                                    │
│ │ Installed │ ← Product installed at client location             │
│ └───────────┘                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Material Statuses & Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                   MATERIAL STATUS FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐                                                │
│   │ Not Ordered │ ← Initial state when added to product          │
│   └──────┬──────┘                                                │
│          │ [Material included in order & order placed]           │
│          ↓                                                       │
│   ┌─────────┐                                                    │
│   │ Ordered │ ← Automatically when order status = Sent           │
│   └────┬────┘                                                    │
│        │ [Order item marked as received]                         │
│        ↓                                                         │
│   ┌──────────┐                                                   │
│   │ Received │ ← Automatically or manually                       │
│   └────┬─────┘                                                   │
│        │ [Production started on product]                         │
│        ↓                                                         │
│   ┌────────┐                                                     │
│   │ In Use │ ← When product enters production                    │
│   └───┬────┘                                                     │
│       │ [Product completed/installed]                            │
│       ↓                                                          │
│   ┌───────────┐                                                  │
│   │ Installed │ ← When product marked as Installed               │
│   └───────────┘                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Automatic Status Update Functions

```javascript
/**
 * Called when an order is placed (status changed to 'Sent')
 */
function onOrderPlaced(orderId) {
  const orderItems = getOrderItems(orderId);
  
  // Update material statuses
  orderItems.forEach(item => {
    updateMaterialStatus(item.productMaterialId, 'Ordered');
  });
  
  // Get affected products
  const affectedProducts = getUniqueProducts(orderItems);
  
  affectedProducts.forEach(productId => {
    const product = getProduct(productId);
    if (product.status === 'Pending') {
      updateProductStatus(productId, 'Materials Ordered');
    }
  });
  
  // Get affected projects
  const affectedProjects = getUniqueProjects(orderItems);
  
  affectedProjects.forEach(projectId => {
    const project = getProject(projectId);
    if (project.status === 'Approved') {
      updateProjectStatus(projectId, 'In Production');
    }
  });
}

/**
 * Called when client accepts an offer
 */
function onOfferAccepted(offerId) {
  const offer = getOffer(offerId);
  
  // Update offer
  updateOfferStatus(offerId, 'Accepted');
  setOfferAcceptedDate(offerId, new Date());
  
  // Update project
  updateProjectStatus(offer.projectId, 'Approved');
  
  // Create profit tracking entries
  createProfitTrackingEntries(offerId);
}

/**
 * Called when materials are marked as received
 */
function onMaterialsReceived(orderItemIds) {
  orderItemIds.forEach(itemId => {
    const item = getOrderItem(itemId);
    updateMaterialStatus(item.productMaterialId, 'Received');
  });
  
  // Check if all materials for any products are now received
  const affectedProducts = getAffectedProducts(orderItemIds);
  
  affectedProducts.forEach(productId => {
    if (allMaterialsReceived(productId)) {
      updateProductStatus(productId, 'Materials Ready');
    }
  });
  
  // Check if all materials for project are received
  const affectedProjects = getAffectedProjects(orderItemIds);
  
  affectedProjects.forEach(projectId => {
    if (allProjectMaterialsReceived(projectId)) {
      updateProjectStatus(projectId, 'Assembly');
    }
  });
}

/**
 * Called when all products in a project are marked as Ready
 */
function checkProjectReadyForInstallation(projectId) {
  if (allProductsReady(projectId)) {
    updateProjectStatus(projectId, 'Installation');
  }
}

/**
 * Called when all products in a project are marked as Installed
 */
function checkProjectCompleted(projectId) {
  if (allProductsInstalled(projectId)) {
    updateProjectStatus(projectId, 'Completed');
  }
}
```

---

## 5. User Interface

### Design Principles
- **Apple-style aesthetics**: Clean, minimal, lots of white space
- **Typography**: System fonts, clear hierarchy
- **Colors**: Neutral palette with subtle accent color
- **Responsive**: Works on desktop and tablet
- **Micro-interactions**: Smooth transitions, hover states

### Main Navigation (Tabs)
1. **Projects** - Main overview with expandable hierarchy
2. **Offers** - Offer management and tracking
3. **Materials** - Materials database management
4. **Ordering** - Create and manage material orders
5. **Workers** - Worker management and task delegation
6. **Reports** - Analytics, profit tracking, summaries

---

## Tab 1: Projects (Main View)

### Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ [Search] [Filter by Status ▼] [+ New Project]                   │
├─────────────────────────────────────────────────────────────────┤
│ ▶ Project: Kitchen Renovation - Smith                           │
│   Client: John Smith | Status: [In Production ▼] | Mode: PreCut │
│ ──────────────────────────────────────────────────────────────  │
│ ▼ Project: Bedroom Set - Johnson                                │
│   Client: Mary Johnson | Status: [Approved ▼] | Mode: InHouse   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Products (3):                          [+ Add Product]   │   │
│   │ ┌───────────────────────────────────────────────────────┐│   │
│   │ │ ▶ Wardrobe | 220×180×60 | Qty: 1 | Mat: €800 | [Cut▼] ││   │
│   │ └───────────────────────────────────────────────────────┘│   │
│   │ ┌───────────────────────────────────────────────────────┐│   │
│   │ │ ▼ Nightstand | 50×45×40 | Qty: 2 | Mat: €150          ││   │
│   │ │   Materials (3):                   [+ Add Material]   ││   │
│   │ │   ┌─────────────────────────────────────────────────┐ ││   │
│   │ │   │ MDF Panel 18mm | 0.5 m² | €25/m² | €12.50      │ ││   │
│   │ │   │   Supplier: Panel Plus | Status: [Ordered]      │ ││   │
│   │ │   ├─────────────────────────────────────────────────┤ ││   │
│   │ │   │ Edge Band Oak | 3 m | €2/m | €6.00              │ ││   │
│   │ │   │   Supplier: Edge Co | Status: [Not Ordered]     │ ││   │
│   │ │   ├─────────────────────────────────────────────────┤ ││   │
│   │ │   │ Hinges Blum | 4 pcs | €3.50/pc | €14.00        │ ││   │
│   │ │   │   Supplier: Hardware Ltd | Status: [Received]   │ ││   │
│   │ │   └─────────────────────────────────────────────────┘ ││   │
│   │ └───────────────────────────────────────────────────────┘│   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Project Row (Collapsed)
- Expand/collapse arrow
- Project name
- Client name
- Status (quick-edit dropdown)
- Production mode badge
- Action buttons (Edit, Create Offer, Delete)

### Product Row Columns
| Column | Description |
|--------|-------------|
| Expand | Arrow to show materials |
| Name | Product name |
| Dimensions | H × W × D in mm |
| Quantity | Number of units |
| Material Cost | **Auto-calculated** from materials |
| Status | **Quick-edit dropdown** |
| Actions | Edit, Delete |

### Material Row Display
| Field | Description |
|--------|-------------|
| Material Name | From materials database |
| Quantity + Unit | e.g., "0.5 m²" |
| Unit Price | Price per unit |
| Total Price | Quantity × Unit Price |
| Supplier | Assigned supplier |
| Status | Current status badge |

---

## Tab 2: Offers

### Offers List View
```
┌─────────────────────────────────────────────────────────────────┐
│ OFFERS                         [Filter ▼] [Search] [+ New Offer]│
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PON-2024-001 | Kitchen Smith | Created: 15.01.2024          │ │
│ │ Status: [Accepted ✓] | Total: €4,500 | Profit: +€850       │ │
│ │ [View] [PDF] [Duplicate] [Track Profit]                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PON-2024-002 | Bedroom Johnson | Created: 18.01.2024        │ │
│ │ Status: [Sent ○] | Total: €2,800 | Valid until: 25.01.2024  │ │
│ │ [View] [PDF] [Edit] [Mark Accepted] [Mark Rejected]         │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Create/Edit Offer View
```
┌─────────────────────────────────────────────────────────────────┐
│ CREATE OFFER                                                     │
│ Project: Bedroom Set - Johnson                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ STEP 1: SELECT PRODUCTS                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☑ │ Product      │ Qty │ Mat. Cost │ Include in offer?      │ │
│ │ ☑ │ Wardrobe     │ 1   │ €800      │ ☑ Yes                  │ │
│ │ ☑ │ Nightstand   │ 2   │ €150      │ ☑ Yes                  │ │
│ │ □ │ Desk         │ 1   │ €200      │ □ No                   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ STEP 2: CONFIGURE EACH PRODUCT                                   │
│ ──────────────────────────────────────────────────────────────  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ WARDROBE (Qty: 1)                                           │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ Material Cost:     €800.00 (read-only)                      │ │
│ │ Margin:            [€200   ] [Fixed ▼]  → Price: €1,000     │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ EXTRAS:                                                     │ │
│ │ ☑ LED:    Meters: [3.5] × Price/m: [€15] = €52.50          │ │
│ │ ☑ Grouting:                   Price: [€30] = €30.00         │ │
│ │ □ Sink/Faucet Install:        Price: [   ]                  │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ CUSTOM EXTRAS:                              [+ Add Extra]   │ │
│ │ ┌───────────────────────────────────────────────────────┐   │ │
│ │ │ Special LED Controller | 1 pcs × €45 = €45.00   [🗑]  │   │ │
│ │ └───────────────────────────────────────────────────────┘   │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ PRODUCT TOTAL: €1,127.50                                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ NIGHTSTAND (Qty: 2)                                         │ │
│ │ ... (similar structure)                                     │ │
│ │ PRODUCT TOTAL: €400.00 (€200 × 2)                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ STEP 3: GLOBAL SETTINGS                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Transport Cost:     [€100    ] (divided proportionally)     │ │
│ │ On-site Assembly:   [☑] Discount: [€50] (divided prop.)     │ │
│ │ Valid Until:        [2024-01-25]                            │ │
│ │ Notes:              [                                ]      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ STEP 4: SUMMARY                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Product        │ Material │ Margin │ Extras │ Transport │ $ │ │
│ │ Wardrobe       │ €800     │ €200   │ €127.50│ +€65.85   │...│ │
│ │ Nightstand ×2  │ €300     │ €100   │ €0     │ +€34.15   │...│ │
│ │────────────────────────────────────────────────────────────│ │
│ │ Subtotal:                                     €1,527.50    │ │
│ │ Transport:                                    +€100.00     │ │
│ │ On-site Discount:                             -€50.00      │ │
│ │ ═══════════════════════════════════════════════════════════│ │
│ │ TOTAL:                                        €1,577.50    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ [Save Draft] [Generate PDF] [Send to Client] [Cancel]            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tab 3: Materials Database

### Features
- Full CRUD for materials catalog
- Search and filter by category
- Import/export functionality
- Default supplier assignment
- Price history tracking

### Material Form Fields
- Name (required)
- Category (dropdown)
- Unit of measure (dropdown)
- Default price per unit
- Default supplier (dropdown)
- Description

---

## Tab 4: Ordering

### Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ CREATE ORDER                                    [Order History] │
├─────────────────────────────────────────────────────────────────┤
│ STEP 1: FILTERS                                                  │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐     │
│ │ Project ▼       │ │ Products ▼      │ │ Supplier ▼      │     │
│ │ □ All           │ │ □ All           │ │ □ All           │     │
│ │ ☑ Kitchen Smith │ │ ☑ Wardrobe      │ │ ☑ Panel Plus    │     │
│ │ □ Bedroom Johns │ │ □ Nightstand    │ │ □ Hardware Ltd  │     │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│ STEP 2: MATERIALS (showing only "Not Ordered")                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ☑ │ Material       │ Qty  │ Unit │ Price │ Project  │ Prod  │ │
│ │ ☑ │ MDF Panel 18mm │ 2    │ m²   │ €25   │ Kitchen  │ Ward. │ │
│ │ ☑ │ MDF Panel 18mm │ 0.5  │ m²   │ €25   │ Bedroom  │ Night.│ │
│ │ ☑ │ Hinges Blum    │ 8    │ pcs  │ €3.50 │ Kitchen  │ Ward. │ │
│ │ □ │ Edge Band Oak  │ 10   │ m    │ €2    │ Bedroom  │ Night.│ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ☑ Aggregate same materials: MDF Panel 18mm → Total: 2.5 m²      │
├─────────────────────────────────────────────────────────────────┤
│ STEP 3: ORDER DETAILS                                            │
│ Supplier: Panel Plus                                             │
│ Selected Items: 3                                                │
│ Estimated Total: €91.50                                          │
│ Expected Delivery: [2024-01-25]                                  │
│ Notes: [                                ]                        │
│                                                                  │
│ [Save Draft] [Generate PDF] [Mark as Ordered]                    │
└─────────────────────────────────────────────────────────────────┘
```

### Ordering Workflow
1. **Filter Selection**: Choose projects, products, and/or suppliers
2. **Material Review**: See all matching materials with `Not Ordered` status
3. **Selection**: Check materials to include in order
4. **Aggregation**: Option to combine same materials from different products
5. **PDF Generation**: Create printable order document
6. **Mark Ordered**: Updates material status to `Ordered` (triggers automation)

### What Happens When "Mark as Ordered"
1. Order status → `Sent`
2. All included materials → status `Ordered`
3. Each affected product → status `Materials Ordered` (if was `Pending`)
4. Each affected project → status `In Production` (if was `Approved`)

---

## Tab 5: Workers & Tasks

### Worker Management
- List all workers with status
- Add/edit/remove workers
- View assigned tasks per worker

### Task Delegation
- Create tasks for specific projects/products
- Assign workers based on role and availability
- Track task progress
- Different task types based on production mode

---

## Tab 6: Reports & Profit Tracking

### Profit Tracking View
```
┌─────────────────────────────────────────────────────────────────┐
│ PROFIT TRACKING                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Filter: [All Offers ▼] [Date Range: ▼]                          │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PON-2024-001 - Kitchen Smith                                │ │
│ │ Offer Total: €4,500                                         │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ Product     │ Offer Mat. │ Current Mat. │ Δ Cost │ Profit Δ │ │
│ │ Wardrobe    │ €800       │ €820         │ +€20   │ -€20     │ │
│ │ Cabinets    │ €1,200     │ €1,180       │ -€20   │ +€20     │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ Expected Profit: €850  │  Current Profit: €850  │  Δ: €0    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ SUMMARY                                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Total Offers: 15                                            │ │
│ │ Expected Total Profit: €12,500                              │ │
│ │ Current Projected Profit: €11,800                           │ │
│ │ Profit Variance: -€700 (5.6% less)                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Available Reports
- Projects by status
- Materials pending order
- Worker workload
- Revenue by period
- Material costs by supplier
- **Profit analysis per offer**
- **Cost variance tracking**

---

## 6. Post-Offer Material Changes

### Scenario
After creating an offer and even after client accepts, you may:
- Receive different prices from suppliers
- Need to substitute materials
- Change quantities

### How It Works

1. **Material prices can always be updated** in Product_Materials
2. **Product Material_Cost is always recalculated** from current materials
3. **Offer keeps snapshot** of original material costs in Offer_Products
4. **Profit_Tracking table** tracks differences

```javascript
function updateMaterialPrice(productMaterialId, newPrice) {
  // Update the material price
  updateProductMaterial(productMaterialId, { unitPrice: newPrice });
  
  // Recalculate product material cost
  const productId = getProductIdFromMaterial(productMaterialId);
  recalculateProductMaterialCost(productId);
  
  // Update profit tracking for any accepted offers
  const affectedOffers = getAcceptedOffersForProduct(productId);
  affectedOffers.forEach(offer => {
    updateProfitTracking(offer.id, productId);
  });
}

function recalculateProductMaterialCost(productId) {
  const materials = getProductMaterials(productId);
  const totalCost = materials.reduce((sum, m) => sum + (m.quantity * m.unitPrice), 0);
  updateProduct(productId, { materialCost: totalCost });
}

function updateProfitTracking(offerId, productId) {
  const offerProduct = getOfferProduct(offerId, productId);
  const currentMaterialCost = getProduct(productId).materialCost;
  
  const tracking = getProfitTracking(offerId, productId);
  
  updateProfitTrackingEntry(tracking.id, {
    currentMaterialCost: currentMaterialCost,
    costDifference: currentMaterialCost - tracking.originalMaterialCost,
    currentProfit: offerProduct.sellingPrice - currentMaterialCost,
    profitChange: (offerProduct.sellingPrice - currentMaterialCost) - tracking.expectedProfit,
    lastUpdated: new Date()
  });
}
```

---

## 7. File Structure

```
/
├── Code.gs                 # Main backend logic, doGet
├── Database.gs             # All CRUD operations for sheets
├── Ordering.gs             # Order generation and PDF creation
├── Offers.gs               # Offer management and calculations
├── StatusAutomation.gs     # All automatic status updates
├── ProfitTracking.gs       # Profit tracking calculations
├── Utils.gs                # Helper functions, UUID generation
├── index.html              # Main HTML template
├── Styles.html             # CSS styles (included in index)
├── JavaScript.html         # Client-side JavaScript (included in index)
├── Components.html         # Reusable UI components
└── PrintTemplates.html     # PDF templates for orders and offers
```

---

## 8. Backend Functions

### Core Functions

```javascript
// Initialization
function doGet() { /* Serve web app */ }
function initializeSheets() { /* Create sheets if not exist */ }

// Projects
function getProjects() { /* Return all projects with products */ }
function saveProject(data) { /* Create or update project */ }
function deleteProject(id) { /* Delete project and cascade */ }
function updateProjectStatus(id, status) { /* Update with automation check */ }

// Products
function getProductsByProject(projectId) { /* Return products with materials */ }
function saveProduct(data) { /* Create or update product */ }
function deleteProduct(id) { /* Delete product and materials */ }
function updateProductStatus(id, status) { /* Quick status update */ }
function recalculateProductCost(productId) { /* Recalc from materials */ }

// Product Materials
function getProductMaterials(productId) { /* Return materials for product */ }
function addMaterialToProduct(data) { /* Add material with price calc */ }
function updateProductMaterial(id, data) { /* Update qty, price, etc. */ }
function deleteMaterialFromProduct(id) { /* Remove and recalc */ }

// Offers
function getOffers(filters) { /* Return offers with optional filters */ }
function getOfferDetails(offerId) { /* Full offer with products, extras */ }
function createOffer(projectId) { /* Initialize new offer */ }
function saveOffer(data) { /* Save offer with products and extras */ }
function calculateOfferTotals(offerId) { /* Recalculate all prices */ }
function updateOfferStatus(id, status) { /* With automation triggers */ }
function generateOfferPDF(offerId) { /* Generate PDF blob */ }
function duplicateOffer(offerId) { /* Create copy for revision */ }

// Ordering
function getOrderableMaterials(filters) { /* Filter materials for ordering */ }
function createOrder(data) { /* Create new order */ }
function markOrderSent(orderId) { /* Trigger status automations */ }
function markMaterialsReceived(orderItemIds) { /* With automations */ }
function generateOrderPDF(orderId) { /* Generate PDF blob */ }
function updateOrderItemPrice(id, actualPrice) { /* Update real price */ }

// Profit Tracking
function getProfitTracking(filters) { /* Get tracking data */ }
function createProfitTrackingEntries(offerId) { /* Initialize tracking */ }
function updateProfitTracking(offerId, productId) { /* Recalculate */ }
function getProfitSummary(dateRange) { /* Aggregate profit data */ }

// Status Automation
function onOrderPlaced(orderId) { /* See automation section */ }
function onOfferAccepted(offerId) { /* See automation section */ }
function onMaterialsReceived(orderItemIds) { /* See automation section */ }
function checkAndUpdateStatuses(entityType, entityId) { /* Smart update */ }

// Suppliers
function getSuppliers() { /* Return all suppliers */ }
function saveSupplier(data) { /* Create or update supplier */ }

// Workers & Tasks
function getWorkers() { /* Return all workers */ }
function saveWorker(data) { /* Create or update worker */ }
function getTasks(filters) { /* Return tasks with filters */ }
function saveTask(data) { /* Create or update task */ }

// Materials Database
function getMaterialsCatalog() { /* Return all materials */ }
function saveMaterial(data) { /* Create or update material */ }
function deleteMaterial(id) { /* Delete from catalog */ }
```

---

## 9. CSS Guidelines

### Color Palette
```css
:root {
  --background: #ffffff;
  --surface: #f5f5f7;
  --surface-hover: #e8e8ed;
  --text-primary: #1d1d1f;
  --text-secondary: #86868b;
  --accent: #0071e3;
  --accent-hover: #0077ed;
  --success: #34c759;
  --warning: #ff9500;
  --error: #ff3b30;
  --border: #d2d2d7;
  --shadow: rgba(0, 0, 0, 0.04);
  --profit-positive: #34c759;
  --profit-negative: #ff3b30;
}
```

### Status Colors
```css
.status-draft { background: #e8e8ed; color: #86868b; }
.status-quoted { background: #fff3cd; color: #856404; }
.status-approved { background: #d4edda; color: #155724; }
.status-production { background: #cce5ff; color: #004085; }
.status-assembly { background: #d1ecf1; color: #0c5460; }
.status-installation { background: #e2d5f1; color: #5a3d7a; }
.status-completed { background: #c3e6cb; color: #155724; }
.status-cancelled { background: #f8d7da; color: #721c24; }
```

---

## 10. Implementation Order

### Phase 1: Foundation
1. Set up project structure
2. Create all sheets with headers
3. Implement basic CRUD for each entity
4. Build main HTML template with navigation

### Phase 2: Projects & Products
1. Project list with expand/collapse
2. Product nesting with expand/collapse
3. Material nesting under products
4. Material cost auto-calculation
5. Quick status edit dropdowns
6. Project/Product create/edit modals

### Phase 3: Offers System
1. Offer creation workflow
2. Product selection for offer
3. Per-product margin and extras
4. Transport and discount distribution
5. Offer PDF generation
6. Offer status management

### Phase 4: Ordering System
1. Multi-filter selection UI
2. Material aggregation logic
3. PDF generation
4. Status automation on order

### Phase 5: Status Automation
1. Implement all status transition functions
2. Wire up automations to actions
3. Test all status flows

### Phase 6: Profit Tracking
1. Create profit tracking entries on offer accept
2. Update tracking on material price changes
3. Build profit analysis views

### Phase 7: Workers & Tasks
1. Worker management
2. Task creation and assignment
3. Task status tracking

### Phase 8: Polish
1. Responsive design
2. Error handling
3. Loading states
4. Toast notifications
5. Print stylesheets

---

## 11. Testing Checklist

### Project/Product/Material Flow
- [ ] Create project with all fields
- [ ] Add products to project
- [ ] Add materials to products
- [ ] Verify material cost auto-calculates
- [ ] Quick-edit status dropdowns work
- [ ] Expand/collapse works at all levels

### Offer Flow
- [ ] Create offer from project
- [ ] Select/deselect products
- [ ] Set margins per product
- [ ] Add LED, grouting, sink extras
- [ ] Add custom extras
- [ ] Transport cost divides proportionally
- [ ] On-site discount divides proportionally
- [ ] Generate offer PDF
- [ ] Mark offer as sent/accepted/rejected

### Ordering Flow
- [ ] Filter materials by project/product/supplier
- [ ] Aggregate same materials
- [ ] Generate order PDF
- [ ] Mark as ordered → statuses update automatically
- [ ] Mark materials received → statuses update

### Profit Tracking
- [ ] Profit tracking created on offer accept
- [ ] Change material price → profit updates
- [ ] Current vs expected profit displays correctly

### Status Automation
- [ ] Project Draft → Quoted (when offer created)
- [ ] Project Quoted → Approved (when offer accepted)
- [ ] Project Approved → In Production (when materials ordered)
- [ ] Project In Production → Assembly (when all materials received)
- [ ] Project Assembly → Installation (when all products Ready)
- [ ] Project → Completed (when all products Installed)
- [ ] Product Pending → Materials Ordered → Materials Ready
- [ ] Material Not Ordered → Ordered → Received

---

## 12. Localization

The app should support Bosnian/Croatian/Serbian language. Key terms:

| English | Local |
|---------|-------|
| Project | Projekat |
| Product | Proizvod |
| Material | Materijal |
| Order | Narudžba |
| Offer/Quote | Ponuda |
| Worker | Radnik |
| Task | Zadatak |
| Status | Status |
| Supplier | Dobavljač |
| Customer/Client | Kupac/Klijent |
| Address | Adresa |
| Quantity | Količina |
| Price | Cijena |
| Total | Ukupno |
| Margin | Marža |
| Transport | Transport |
| Discount | Popust |
| On-site Assembly | Sklapanje na licu mjesta |
| LED | LED |
| Grouting | Fugiranje |
| Sink/Faucet | Sudoper/Česma |
| Save | Sačuvaj |
| Cancel | Otkaži |
| Delete | Obriši |
| Edit | Uredi |
| Add | Dodaj |
| Search | Pretraga |
| Filter | Filter |
| Draft | Nacrt |
| Quoted | Ponuđeno |
| Approved | Odobreno |
| In Production | U proizvodnji |
| Assembly | Sklapanje |
| Installation | Montaža |
| Completed | Završeno |
| Cancelled | Otkazano |
| Pending | Na čekanju |
| Ordered | Naručeno |
| Received | Primljeno |
| Materials Ready | Materijali spremni |
| Profit | Profit |
| Expected | Očekivano |
| Current | Trenutno |
| Difference | Razlika |
