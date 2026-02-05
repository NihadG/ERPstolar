'use client';

import { useState, useRef, useCallback } from 'react';
import Modal from './ui/Modal';
import {
    Material,
    Product,
    Worker,
    Supplier,
    Project,
    MATERIAL_CATEGORIES,
    WORKER_ROLES,
    WORKER_TYPES,
    PROJECT_STATUSES,
    PRODUCT_STATUSES,
} from '../lib/types';
import {
    saveMaterial,
    saveProduct,
    saveWorker,
    saveSupplier,
    saveProject,
    getProjects,
} from '../lib/database';
import './CSVImportWizard.css';

interface CSVImportWizardProps {
    isOpen: boolean;
    onClose: () => void;
    organizationId: string;
    onImportComplete?: () => void;
}

type EntityType = 'materials' | 'products' | 'workers' | 'suppliers' | 'projects';

interface EntityConfig {
    name: string;
    namePlural: string;
    icon: string;
    description: string;
    columns: { key: string; label: string; required: boolean }[];
    exampleData: string[][];
}

// CSV format configurations with examples
const CSV_CONFIGS: Record<EntityType, EntityConfig> = {
    materials: {
        name: 'Materijal',
        namePlural: 'Materijali',
        icon: '🧱',
        description: 'Sirovine, dijelovi, potrošni materijal',
        columns: [
            { key: 'Name', label: 'Naziv', required: true },
            { key: 'Category', label: 'Kategorija', required: true },
            { key: 'Unit', label: 'Jedinica', required: true },
            { key: 'Default_Unit_Price', label: 'Cijena', required: false },
            { key: 'Stock_Quantity', label: 'Količina', required: false },
            { key: 'Default_Supplier', label: 'Dobavljač', required: false },
        ],
        exampleData: [
            ['Hrast ploča 18mm', 'Drvo', 'm2', '45.00', '100', 'Drvo d.o.o.'],
            ['Vijak 4x40', 'Vijci', 'kom', '0.15', '5000', 'Metal Plus'],
            ['Lak bezbojni', 'Lakovi i boje', 'L', '12.50', '25', ''],
        ]
    },
    products: {
        name: 'Proizvod',
        namePlural: 'Proizvodi',
        icon: '🪑',
        description: 'Gotovi proizvodi za projekte',
        columns: [
            { key: 'Name', label: 'Naziv', required: true },
            { key: 'Description', label: 'Opis', required: false },
            { key: 'Product_Value', label: 'Cijena', required: false },
            { key: 'Width', label: 'Širina (cm)', required: false },
            { key: 'Height', label: 'Visina (cm)', required: false },
            { key: 'Depth', label: 'Dubina (cm)', required: false },
        ],
        exampleData: [
            ['Kuhinjski ormar gornji', 'Gornji element sa staklom', '350.00', '60', '72', '35'],
            ['Radna ploča', 'Radna ploča 4cm granit', '180.00', '300', '4', '60'],
            ['Pult', 'Kuhinjski pult sa ladicama', '520.00', '80', '85', '60'],
        ]
    },
    workers: {
        name: 'Radnik',
        namePlural: 'Radnici',
        icon: '👷',
        description: 'Zaposlenici i kooperanti',
        columns: [
            { key: 'First_Name', label: 'Ime', required: true },
            { key: 'Last_Name', label: 'Prezime', required: true },
            { key: 'Role', label: 'Uloga', required: false },
            { key: 'Type', label: 'Tip', required: false },
            { key: 'Daily_Rate', label: 'Dnevnica', required: false },
            { key: 'Phone', label: 'Telefon', required: false },
        ],
        exampleData: [
            ['Marko', 'Horvat', 'Stolar', 'Stalni', '80.00', '091 123 4567'],
            ['Ivan', 'Perić', 'Šlajfer', 'Stalni', '70.00', '098 765 4321'],
            ['Ante', 'Matić', 'Monter', 'Honorarni', '100.00', ''],
        ]
    },
    suppliers: {
        name: 'Dobavljač',
        namePlural: 'Dobavljači',
        icon: '🚚',
        description: 'Dobavljači materijala i usluga',
        columns: [
            { key: 'Name', label: 'Naziv', required: true },
            { key: 'Contact_Person', label: 'Kontakt osoba', required: false },
            { key: 'Phone', label: 'Telefon', required: false },
            { key: 'Email', label: 'Email', required: false },
            { key: 'Address', label: 'Adresa', required: false },
            { key: 'Categories', label: 'Kategorija', required: false },
        ],
        exampleData: [
            ['Drvo d.o.o.', 'Petar Novak', '01 234 5678', 'info@drvo.hr', 'Industrijska 15, Zagreb', 'Drvo'],
            ['Metal Plus', 'Ana Kovač', '01 876 5432', 'prodaja@metal.hr', 'Radnička 42, Split', 'Okovi'],
            ['Lak Color', '', '091 555 1234', '', 'Obrtnicka 8, Osijek', 'Lakovi i boje'],
        ]
    },
    projects: {
        name: 'Projekt',
        namePlural: 'Projekti',
        icon: '📋',
        description: 'Narudžbe i projekti klijenata',
        columns: [
            { key: 'Client_Name', label: 'Klijent', required: true },
            { key: 'Address', label: 'Adresa', required: false },
            { key: 'Phone', label: 'Telefon', required: false },
            { key: 'Email', label: 'Email', required: false },
            { key: 'Status', label: 'Status', required: false },
            { key: 'Notes', label: 'Napomene', required: false },
        ],
        exampleData: [
            ['Marko Horvat', 'Vukovarska 123, Zagreb', '091 234 5678', 'marko@email.com', 'Nacrt', 'Kuhinja i dnevni boravak'],
            ['Hotel Sunset', 'Obala 1, Zadar', '023 456 789', 'recepcija@sunset.hr', 'Odobreno', '15 soba'],
            ['Ivan Jurić', 'Šetalište 45, Rijeka', '', 'ivan.juric@gmail.com', 'Nacrt', ''],
        ]
    }
};

type ParsedItem = Record<string, unknown> & {
    _selected?: boolean;
    _row?: number;
};

export default function CSVImportWizard({
    isOpen,
    onClose,
    organizationId,
    onImportComplete,
}: CSVImportWizardProps) {
    // Wizard state
    const [step, setStep] = useState(1);
    const [entityType, setEntityType] = useState<EntityType | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);

    // File state
    const [file, setFile] = useState<File | null>(null);
    const [parseError, setParseError] = useState<string | null>(null);
    const [parsedData, setParsedData] = useState<ParsedItem[]>([]);

    // Import state
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Reset wizard
    const resetWizard = useCallback(() => {
        setStep(1);
        setEntityType(null);
        setSelectedProjectId(null);
        setFile(null);
        setParsedData([]);
        setParseError(null);
        setImportResults(null);
        setImportProgress({ current: 0, total: 0 });
    }, []);

    // Handle close
    const handleClose = () => {
        resetWizard();
        onClose();
    };

    // Select entity type
    const handleSelectEntityType = async (type: EntityType) => {
        setEntityType(type);

        if (type === 'products') {
            try {
                const projectsList = await getProjects(organizationId);
                setProjects(projectsList);
                setStep(1.5);
            } catch (error) {
                console.error('Error loading projects:', error);
                setStep(2);
            }
        } else {
            setStep(2);
        }
    };

    // Select project (for products)
    const handleSelectProject = (projectId: string) => {
        setSelectedProjectId(projectId);
        setStep(2);
    };

    // Download example CSV
    const downloadExampleCSV = () => {
        if (!entityType) return;

        const config = CSV_CONFIGS[entityType];
        const headers = config.columns.map(c => c.label);
        const rows = config.exampleData;

        const csvContent = [
            headers.join(';'),
            ...rows.map(row => row.join(';'))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primjer_${entityType}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Parse CSV file
    const parseCSV = (content: string): string[][] => {
        const lines = content.split(/\r?\n/).filter(line => line.trim());
        return lines.map(line => {
            // Handle semicolon and comma separators
            const separator = line.includes(';') ? ';' : ',';
            return line.split(separator).map(cell => cell.trim().replace(/^["']|["']$/g, ''));
        });
    };

    // Handle file select
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile || !entityType) return;

        setFile(selectedFile);
        setParseError(null);

        try {
            const content = await selectedFile.text();
            const rows = parseCSV(content);

            if (rows.length < 2) {
                setParseError('CSV mora imati zaglavlje i barem jedan red podataka');
                return;
            }

            const config = CSV_CONFIGS[entityType];
            const headerRow = rows[0];
            const dataRows = rows.slice(1);

            // Map column indices
            const columnMap: Record<string, number> = {};
            config.columns.forEach(col => {
                const index = headerRow.findIndex(h =>
                    h.toLowerCase() === col.label.toLowerCase() ||
                    h.toLowerCase() === col.key.toLowerCase().replace(/_/g, ' ')
                );
                if (index !== -1) {
                    columnMap[col.key] = index;
                }
            });

            // Check required columns
            const missingRequired = config.columns
                .filter(c => c.required && columnMap[c.key] === undefined)
                .map(c => c.label);

            if (missingRequired.length > 0) {
                setParseError(`Nedostaju obavezne kolone: ${missingRequired.join(', ')}`);
                return;
            }

            // Parse data rows
            const parsed: ParsedItem[] = dataRows.map((row, idx) => {
                const item: ParsedItem = { _selected: true, _row: idx + 2 };
                config.columns.forEach(col => {
                    const index = columnMap[col.key];
                    if (index !== undefined && row[index]) {
                        // Handle numeric fields
                        if (['Default_Unit_Price', 'Stock_Quantity', 'Daily_Rate', 'Product_Value', 'Width', 'Height', 'Depth'].includes(col.key)) {
                            const numVal = parseFloat(row[index].replace(',', '.'));
                            item[col.key] = isNaN(numVal) ? 0 : numVal;
                        } else {
                            item[col.key] = row[index];
                        }
                    }
                });
                return item;
            });

            // Filter out empty rows
            const validParsed = parsed.filter(item => {
                const requiredKey = config.columns.find(c => c.required)?.key;
                return requiredKey && item[requiredKey];
            });

            if (validParsed.length === 0) {
                setParseError('Nema validnih podataka u CSV datoteci');
                return;
            }

            setParsedData(validParsed);
            setStep(3);
        } catch (error) {
            console.error('Error parsing CSV:', error);
            setParseError('Greška pri čitanju CSV datoteke');
        }
    };

    // Toggle item selection
    const toggleItemSelection = (index: number) => {
        setParsedData(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], _selected: !updated[index]._selected };
            return updated;
        });
    };

    // Update field
    const updateField = (index: number, field: string, value: unknown) => {
        setParsedData(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    // Delete row
    const deleteRow = (index: number) => {
        setParsedData(prev => prev.filter((_, i) => i !== index));
    };

    // Import data
    const handleImport = async () => {
        if (!entityType) return;

        const selectedItems = parsedData.filter(item => item._selected);
        if (selectedItems.length === 0) return;

        setIsImporting(true);
        setImportProgress({ current: 0, total: selectedItems.length });

        const results = { success: 0, failed: 0, errors: [] as string[] };

        for (let i = 0; i < selectedItems.length; i++) {
            const item = { ...selectedItems[i] };
            delete item._selected;
            delete item._row;

            // Add project ID for products
            if (entityType === 'products' && selectedProjectId) {
                item.Project_ID = selectedProjectId;
            }

            // Generate IDs


            try {
                let saveResult: { success: boolean; message: string };

                switch (entityType) {
                    case 'materials':
                        // Let DB generate ID
                        saveResult = await saveMaterial(item as Partial<Material>, organizationId);
                        break;
                    case 'products':
                        // Let DB generate ID
                        item.Status = 'U pripremi';
                        saveResult = await saveProduct(item as Partial<Product>, organizationId);
                        break;
                    case 'workers':
                        // Combine First and Last Name
                        if (item.First_Name && item.Last_Name) {
                            item.Name = `${item.First_Name} ${item.Last_Name}`;
                        } else if (item.First_Name) {
                            item.Name = item.First_Name;
                        } else if (item.Last_Name) {
                            item.Name = item.Last_Name;
                        }

                        // Let DB generate ID
                        item.Status = 'Aktivan';
                        saveResult = await saveWorker(item as Partial<Worker>, organizationId);
                        break;
                    case 'suppliers':
                        // Let DB generate ID
                        saveResult = await saveSupplier(item as Partial<Supplier>, organizationId);
                        break;
                    case 'projects':
                        // Let DB generate ID
                        item.Status = item.Status || 'Nacrt';
                        saveResult = await saveProject(item as Partial<Project>, organizationId);
                        break;
                    default:
                        saveResult = { success: false, message: 'Nepoznat tip' };
                }

                if (saveResult.success) {
                    results.success++;
                } else {
                    results.failed++;
                    results.errors.push(`Red ${item._row || i + 1}: ${saveResult.message}`);
                }
            } catch (error) {
                results.failed++;
                results.errors.push(`Red ${item._row || i + 1}: ${error instanceof Error ? error.message : 'Greška'}`);
            }

            setImportProgress({ current: i + 1, total: selectedItems.length });
        }

        setImportResults(results);
        setIsImporting(false);
        setStep(4);

        if (onImportComplete) {
            onImportComplete();
        }
    };

    // Render step content
    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div className="csv-import-entity-selection">
                        <p className="csv-import-instruction">Odaberite vrstu podataka za import:</p>
                        <div className="csv-import-entity-grid">
                            {(Object.entries(CSV_CONFIGS) as [EntityType, EntityConfig][]).map(([type, config]) => (
                                <button
                                    key={type}
                                    className="csv-import-entity-card"
                                    onClick={() => handleSelectEntityType(type)}
                                >
                                    <span className="csv-import-entity-icon">{config.icon}</span>
                                    <span className="csv-import-entity-name">{config.namePlural}</span>
                                    <span className="csv-import-entity-desc">{config.description}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                );

            case 1.5:
                return (
                    <div className="csv-import-project-selection">
                        <p className="csv-import-instruction">
                            Proizvodi se dodaju u projekat. Odaberite projekat:
                        </p>
                        {projects.length === 0 ? (
                            <div className="csv-import-empty">
                                <span className="material-icons-round">folder_off</span>
                                <p>Nemate nijedan projekat. Kreirajte projekat prvo.</p>
                            </div>
                        ) : (
                            <div className="csv-import-project-list">
                                {projects.map((project) => (
                                    <button
                                        key={project.Project_ID}
                                        className="csv-import-project-card"
                                        onClick={() => handleSelectProject(project.Project_ID)}
                                    >
                                        <span className="csv-import-project-name">{project.Client_Name}</span>
                                        <span className="csv-import-project-address">{project.Address || 'Bez adrese'}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <button className="btn btn-secondary" onClick={() => setStep(1)}>
                            <span className="material-icons-round">arrow_back</span>
                            Nazad
                        </button>
                    </div>
                );

            case 2:
                if (!entityType) return null;
                const config = CSV_CONFIGS[entityType];

                return (
                    <div className="csv-import-upload">
                        <div className="csv-import-selected-type">
                            <span className="csv-import-type-badge">
                                {config.icon} {config.namePlural}
                            </span>
                            {entityType === 'products' && selectedProjectId && (
                                <span className="csv-import-project-badge">
                                    → {projects.find(p => p.Project_ID === selectedProjectId)?.Client_Name}
                                </span>
                            )}
                        </div>

                        {/* Format Example */}
                        <div className="csv-import-format-example">
                            <h4>
                                <span className="material-icons-round">table_chart</span>
                                Potreban format CSV datoteke:
                            </h4>
                            <div className="csv-format-table-wrapper">
                                <table className="csv-format-table">
                                    <thead>
                                        <tr>
                                            {config.columns.map(col => (
                                                <th key={col.key}>
                                                    {col.label}
                                                    {col.required && <span className="required">*</span>}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {config.exampleData.map((row, idx) => (
                                            <tr key={idx}>
                                                {row.map((cell, cellIdx) => (
                                                    <td key={cellIdx}>{cell}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button className="btn btn-sm btn-outline" onClick={downloadExampleCSV}>
                                <span className="material-icons-round">download</span>
                                Preuzmi primjer CSV
                            </button>
                        </div>

                        {parseError && (
                            <div className="csv-import-error">
                                <span className="material-icons-round">error</span>
                                <p>{parseError}</p>
                            </div>
                        )}

                        {/* Upload Zone */}
                        <div
                            className={`csv-import-dropzone ${file ? 'has-file' : ''}`}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                onChange={handleFileSelect}
                                hidden
                            />
                            {file ? (
                                <>
                                    <div className="icon-container">
                                        <span className="material-icons-round">check_circle</span>
                                    </div>
                                    <div className="csv-import-text">
                                        <h3>{file.name}</h3>
                                        <p>{(file.size / 1024).toFixed(1)} KB • Spreman za analizu</p>
                                    </div>
                                    <button
                                        className="btn btn-sm btn-outline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setFile(null);
                                        }}
                                        style={{ marginTop: 12 }}
                                    >
                                        Zamijeni datoteku
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="icon-container">
                                        <span className="material-icons-round">cloud_upload</span>
                                    </div>
                                    <div className="csv-import-text">
                                        <h3>Kliknite za odabir CSV datoteke</h3>
                                        <p>ili prevucite datoteku ovdje</p>
                                    </div>
                                    <span className="csv-import-formats">Podržani format: .csv (separator: ; ili ,)</span>
                                </>
                            )}
                        </div>

                        <div className="csv-import-actions">
                            <button className="btn btn-secondary" onClick={() => setStep(entityType === 'products' ? 1.5 : 1)}>
                                <span className="material-icons-round">arrow_back</span>
                                Nazad
                            </button>
                        </div>
                    </div>
                );

            case 3:
                if (!entityType) return null;
                const previewConfig = CSV_CONFIGS[entityType];
                const selectedCount = parsedData.filter(item => item._selected).length;

                return (
                    <div className="csv-import-preview">
                        <div className="csv-import-table-header">
                            <span>Pronađeno {parsedData.length} zapisa, odabrano {selectedCount}</span>
                        </div>

                        <div className="csv-import-table-wrapper">
                            <table className="csv-import-table">
                                <thead>
                                    <tr>
                                        <th className="col-select">
                                            <input
                                                type="checkbox"
                                                checked={parsedData.every(item => item._selected)}
                                                onChange={(e) => {
                                                    setParsedData(prev => prev.map(item => ({
                                                        ...item,
                                                        _selected: e.target.checked
                                                    })));
                                                }}
                                            />
                                        </th>
                                        {previewConfig.columns.map(col => (
                                            <th key={col.key}>
                                                {col.label}
                                                {col.required && <span className="required">*</span>}
                                            </th>
                                        ))}
                                        <th className="col-actions"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsedData.map((item, index) => (
                                        <tr key={index} className={item._selected ? '' : 'deselected'}>
                                            <td className="col-select">
                                                <input
                                                    type="checkbox"
                                                    checked={item._selected}
                                                    onChange={() => toggleItemSelection(index)}
                                                />
                                            </td>
                                            {previewConfig.columns.map(col => (
                                                <td key={col.key}>
                                                    <input
                                                        type="text"
                                                        value={(item[col.key] as string) || ''}
                                                        onChange={(e) => updateField(index, col.key, e.target.value)}
                                                        className="csv-import-input"
                                                    />
                                                </td>
                                            ))}
                                            <td className="col-actions">
                                                <button className="icon-btn danger" onClick={() => deleteRow(index)}>
                                                    <span className="material-icons-round">delete</span>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="csv-import-actions">
                            <button className="btn btn-secondary" onClick={() => { setStep(2); setFile(null); setParsedData([]); }}>
                                <span className="material-icons-round">arrow_back</span>
                                Nazad
                            </button>
                            <button
                                className="btn btn-success"
                                onClick={handleImport}
                                disabled={selectedCount === 0}
                            >
                                <span className="material-icons-round">save</span>
                                Importuj {selectedCount} zapisa
                            </button>
                        </div>
                    </div>
                );

            case 4:
                return (
                    <div className="csv-import-results">
                        {isImporting ? (
                            <div className="csv-import-progress">
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                                    />
                                </div>
                                <p>Importujem... {importProgress.current} / {importProgress.total}</p>
                            </div>
                        ) : importResults && (
                            <>
                                <div className={`csv-import-result-summary ${importResults.failed > 0 ? 'has-errors' : 'success'}`}>
                                    <span className="material-icons-round">
                                        {importResults.failed > 0 ? 'warning' : 'check_circle'}
                                    </span>
                                    <div>
                                        <h3>Import završen</h3>
                                        <p>
                                            <strong>{importResults.success}</strong> uspješno,
                                            <strong className="error-count"> {importResults.failed}</strong> neuspješno
                                        </p>
                                    </div>
                                </div>

                                {importResults.errors.length > 0 && (
                                    <div className="csv-import-errors">
                                        <h4>Greške:</h4>
                                        <ul>
                                            {importResults.errors.map((err, i) => (
                                                <li key={i}>{err}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div className="csv-import-actions">
                                    <button className="btn btn-secondary" onClick={resetWizard}>
                                        <span className="material-icons-round">refresh</span>
                                        Novi import
                                    </button>
                                    <button className="btn btn-primary" onClick={handleClose}>
                                        <span className="material-icons-round">check</span>
                                        Zatvori
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    // Progress indicator
    const getProgressStep = () => {
        if (step === 1 || step === 1.5) return 1;
        if (step === 2) return 2;
        if (step === 3) return 3;
        return 4;
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={
                <div className="csv-import-header">
                    <span className="material-icons-round">upload_file</span>
                    <span>CSV Import</span>
                </div>
            }
            size="xl"
        >
            <div className="csv-import-wizard">
                {/* Progress Steps */}
                <div className="csv-import-steps">
                    {['Odabir tipa', 'Format & Upload', 'Pregled', 'Import'].map((label, index) => (
                        <div
                            key={index}
                            className={`csv-import-step ${getProgressStep() === index + 1 ? 'active' : ''} ${getProgressStep() > index + 1 ? 'completed' : ''}`}
                        >
                            <div className="step-number">
                                {getProgressStep() > index + 1 ? (
                                    <span className="material-icons-round">check</span>
                                ) : (
                                    index + 1
                                )}
                            </div>
                            <span className="step-label">{label}</span>
                        </div>
                    ))}
                </div>

                {/* Step Content */}
                <div className="csv-import-content">
                    {renderStepContent()}
                </div>
            </div>
        </Modal>
    );
}
