// Run this script to seed the database with sample data
// Execute with: node scripts/seed.mjs

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyA1Lh0zEyv306VzNKPHs5pWm3JUwmAMnjM",
    authDomain: "erp-production-e6051.firebaseapp.com",
    projectId: "erp-production-e6051",
    storageBucket: "erp-production-e6051.firebasestorage.app",
    messagingSenderId: "104799047364",
    appId: "1:104799047364:web:4da9802ff0a750547a4391"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function seedDatabase() {
    console.log('🌱 Seeding database...');

    // SUPPLIERS
    const suppliers = [
        { Supplier_ID: generateUUID(), Name: 'Drvo Comerc', Contact_Person: 'Marko Marković', Phone: '061-234-567', Email: 'info@drvo-comerc.ba', Address: 'Sarajevo, Ilidža', Categories: 'Ploča, Kanttraka' },
        { Supplier_ID: generateUUID(), Name: 'Okovi Plus', Contact_Person: 'Ana Anić', Phone: '062-345-678', Email: 'prodaja@okoviplus.ba', Address: 'Zenica', Categories: 'Okovi, Šarke, Ladičari, Ručke' },
        { Supplier_ID: generateUUID(), Name: 'Staklo Centar', Contact_Person: 'Ivan Ivić', Phone: '063-456-789', Email: 'narudzbe@staklocentar.ba', Address: 'Tuzla', Categories: 'Staklo, Alu vrata' }
    ];

    console.log('Adding suppliers...');
    for (const supplier of suppliers) {
        await addDoc(collection(db, 'suppliers'), supplier);
    }

    // MATERIALS
    const materials = [
        { Material_ID: generateUUID(), Name: 'PAL Bijela 18mm', Category: 'Ploča', Unit: 'm²', Default_Supplier: 'Drvo Comerc', Default_Unit_Price: 25.00, Description: 'Bijela univerzalna ploča' },
        { Material_ID: generateUUID(), Name: 'PAL Hrast 18mm', Category: 'Ploča', Unit: 'm²', Default_Supplier: 'Drvo Comerc', Default_Unit_Price: 35.00, Description: 'Hrast dekor ploča' },
        { Material_ID: generateUUID(), Name: 'PAL Orah 18mm', Category: 'Ploča', Unit: 'm²', Default_Supplier: 'Drvo Comerc', Default_Unit_Price: 38.00, Description: 'Orah dekor ploča' },
        { Material_ID: generateUUID(), Name: 'MDF 18mm', Category: 'Ploča', Unit: 'm²', Default_Supplier: 'Drvo Comerc', Default_Unit_Price: 22.00, Description: 'MDF ploča za lakiranje' },
        { Material_ID: generateUUID(), Name: 'Kanttraka Bijela 22mm', Category: 'Kanttraka', Unit: 'm', Default_Supplier: 'Drvo Comerc', Default_Unit_Price: 1.50, Description: 'ABS kanttraka' },
        { Material_ID: generateUUID(), Name: 'Kanttraka Hrast 22mm', Category: 'Kanttraka', Unit: 'm', Default_Supplier: 'Drvo Comerc', Default_Unit_Price: 2.00, Description: 'ABS kanttraka hrast dekor' },
        { Material_ID: generateUUID(), Name: 'Šarka 110°', Category: 'Šarke', Unit: 'kom', Default_Supplier: 'Okovi Plus', Default_Unit_Price: 3.50, Description: 'Blum šarka sa soft-close' },
        { Material_ID: generateUUID(), Name: 'Ladičar Tandem 500mm', Category: 'Ladičari', Unit: 'set', Default_Supplier: 'Okovi Plus', Default_Unit_Price: 45.00, Description: 'Blum Tandem ladičar' },
        { Material_ID: generateUUID(), Name: 'Ručka Inox 128mm', Category: 'Ručke', Unit: 'kom', Default_Supplier: 'Okovi Plus', Default_Unit_Price: 8.00, Description: 'Moderna ručka' },
        { Material_ID: generateUUID(), Name: 'Vijci 4x30mm', Category: 'Vijci', Unit: 'kom', Default_Supplier: 'Okovi Plus', Default_Unit_Price: 0.05, Description: 'Univerzalni vijci' },
        { Material_ID: generateUUID(), Name: 'LED traka 5m', Category: 'LED', Unit: 'set', Default_Supplier: 'Okovi Plus', Default_Unit_Price: 35.00, Description: 'Topla bijela LED' },
        { Material_ID: generateUUID(), Name: 'Kaljeno staklo 6mm', Category: 'Staklo', Unit: 'm²', Default_Supplier: 'Staklo Centar', Default_Unit_Price: 85.00, Description: 'Kaljeno prozirno staklo', Is_Glass: true },
        { Material_ID: generateUUID(), Name: 'Alu profil vrata', Category: 'Alu vrata', Unit: 'set', Default_Supplier: 'Staklo Centar', Default_Unit_Price: 120.00, Description: 'Aluminijski okvir za vrata', Is_Alu_Door: true },
    ];

    console.log('Adding materials...');
    for (const material of materials) {
        await addDoc(collection(db, 'materials'), material);
    }

    // WORKERS
    const workers = [
        { Worker_ID: generateUUID(), Name: 'Hasan Hasić', Role: 'Rezač', Phone: '061-111-222', Status: 'Dostupan' },
        { Worker_ID: generateUUID(), Name: 'Mirza Mirković', Role: 'Kantiranje', Phone: '062-222-333', Status: 'Dostupan' },
        { Worker_ID: generateUUID(), Name: 'Emir Emirović', Role: 'Bušenje', Phone: '063-333-444', Status: 'Dostupan' },
        { Worker_ID: generateUUID(), Name: 'Damir Damirović', Role: 'Montaža', Phone: '064-444-555', Status: 'Dostupan' },
    ];

    console.log('Adding workers...');
    for (const worker of workers) {
        await addDoc(collection(db, 'workers'), worker);
    }

    // SAMPLE PROJECT 1
    const projectId = generateUUID();
    const project = {
        Project_ID: projectId,
        Client_Name: 'Petar Petrović',
        Client_Phone: '061-555-666',
        Client_Email: 'petar@email.com',
        Address: 'Sarajevo, Čengić Vila 15',
        Notes: 'Kuhinja i dnevni boravak - rok 3 sedmice',
        Status: 'Nacrt',
        Production_Mode: 'PreCut',
        Created_Date: new Date().toISOString(),
        Deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString()
    };

    console.log('Adding sample project...');
    await addDoc(collection(db, 'projects'), project);

    const products = [
        { Product_ID: generateUUID(), Project_ID: projectId, Name: 'Gornji kuhinjski ormar 60x72', Height: 720, Width: 600, Depth: 320, Quantity: 4, Status: 'Na čekanju', Material_Cost: 0, Notes: 'Bijela boja sa hrast frontom' },
        { Product_ID: generateUUID(), Project_ID: projectId, Name: 'Donji kuhinjski element 80x85', Height: 850, Width: 800, Depth: 560, Quantity: 3, Status: 'Na čekanju', Material_Cost: 0, Notes: 'Sa ladicama' },
        { Product_ID: generateUUID(), Project_ID: projectId, Name: 'TV komoda 180x45', Height: 450, Width: 1800, Depth: 400, Quantity: 1, Status: 'Na čekanju', Material_Cost: 0, Notes: 'Orah dekor, LED rasvjeta' }
    ];

    console.log('Adding products...');
    for (const product of products) {
        await addDoc(collection(db, 'products'), product);
    }

    // SAMPLE PROJECT 2
    const project2Id = generateUUID();
    const project2 = {
        Project_ID: project2Id,
        Client_Name: 'Amela Amelić',
        Client_Phone: '062-777-888',
        Client_Email: 'amela@email.com',
        Address: 'Zenica, Centar 22',
        Notes: 'Spavaća soba - ormar i komoda',
        Status: 'Ponuđeno',
        Production_Mode: 'InHouse',
        Created_Date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        Deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    };

    await addDoc(collection(db, 'projects'), project2);

    const products2 = [
        { Product_ID: generateUUID(), Project_ID: project2Id, Name: 'Klizni ormar 250x240', Height: 2400, Width: 2500, Depth: 600, Quantity: 1, Status: 'Na čekanju', Material_Cost: 850, Notes: 'Sa ogledalom na srednjim vratima' },
        { Product_ID: generateUUID(), Project_ID: project2Id, Name: 'Noćni ormarić', Height: 500, Width: 450, Depth: 400, Quantity: 2, Status: 'Na čekanju', Material_Cost: 120, Notes: '' }
    ];

    for (const product of products2) {
        await addDoc(collection(db, 'products'), product);
    }

    console.log('');
    console.log('✅ Database seeded successfully!');
    console.log('');
    console.log('Added:');
    console.log('- 3 Suppliers');
    console.log('- 13 Materials');
    console.log('- 4 Workers');
    console.log('- 2 Projects with 5 Products');
    console.log('');
    console.log('🚀 Refresh your browser to see the data!');

    process.exit(0);
}

seedDatabase().catch(console.error);
