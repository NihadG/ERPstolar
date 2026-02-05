'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Modal from './ui/Modal';
import {
    ImportEntityType,
    ENTITY_CONFIGS,
    ParsedDataResult,
    prepareForSave,
} from '../lib/gemini';
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
import './AIImportWizard.css';

interface AIImportWizardProps {
    isOpen: boolean;
    onClose: () => void;
    organizationId: string;
    onImportComplete?: () => void;
}

type ParsedItem = Record<string, unknown> & {
    _confidence?: number;
    _warnings?: string[];
    _selected?: boolean;
    _errors?: string[];
};

export default function AIImportWizard({
    isOpen,
    onClose,
    organizationId,
    onImportComplete,
}: AIImportWizardProps) {
    // Wizard state
    const [step, setStep] = useState(1);
    const [entityType, setEntityType] = useState<ImportEntityType | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);

    // File state
    const [file, setFile] = useState<File | null>(null);
    const [textContent, setTextContent] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Analysis state
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [parsedData, setParsedData] = useState<ParsedItem[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);

    // Import state
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

    // Column resize state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);

    // Reset wizard
    const resetWizard = useCallback(() => {
        setStep(1);
        setEntityType(null);
        setSelectedProjectId(null);
        setFile(null);
        setTextContent('');
        setParsedData([]);
        setWarnings([]);
        setAnalysisError(null);
        setImportResults(null);
        setImportProgress({ current: 0, total: 0 });
    }, []);

    // Handle close
    const handleClose = () => {
        resetWizard();
        onClose();
    };

    // Step 1: Select entity type
    const handleSelectEntityType = async (type: ImportEntityType) => {
        setEntityType(type);

        // If products, load projects first
        if (type === 'products') {
            try {
                const projectsList = await getProjects(organizationId);
                setProjects(projectsList);
                setStep(1.5); // Go to project selection step
            } catch (error) {
                console.error('Error loading projects:', error);
                setStep(2);
            }
        } else {
            setStep(2);
        }
    };

    // Step 1.5: Select project (for products)
    const handleSelectProject = (projectId: string) => {
        setSelectedProjectId(projectId);
        setStep(2);
    };

    // File drag and drop handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) {
            setFile(droppedFile);
            setTextContent('');
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setTextContent('');
        }
    };

    // Analyze content with AI
    const handleAnalyze = async () => {
        if (!entityType || (!file && !textContent.trim())) return;

        setIsAnalyzing(true);
        setAnalysisError(null);
        setStep(3); // Show loader immediately

        try {
            const formData = new FormData();
            formData.append('entityType', entityType);

            if (file) {
                formData.append('file', file);
            } else {
                formData.append('textContent', textContent);
            }

            const response = await fetch('/api/ai-import', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (result.success && result.data) {
                // Add selection state to each item
                const dataWithSelection = result.data.map((item: ParsedItem) => ({
                    ...item,
                    _selected: true,
                    _errors: [],
                }));
                setParsedData(dataWithSelection);
                setWarnings(result.warnings || []);
                setStep(4);
            } else {
                setAnalysisError(result.error || 'Greška pri analizi sadržaja');
                setStep(2); // Go back to upload step on error
            }
        } catch (error) {
            console.error('Analysis error:', error);
            setAnalysisError(error instanceof Error ? error.message : 'Greška pri povezivanju sa serverom');
            setStep(2); // Go back to upload step on error
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Update a single field in parsed data
    const updateField = (index: number, field: string, value: unknown) => {
        setParsedData(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    // Toggle item selection
    const toggleItemSelection = (index: number) => {
        setParsedData(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], _selected: !updated[index]._selected };
            return updated;
        });
    };

    // Add new row
    const addNewRow = () => {
        const config = ENTITY_CONFIGS[entityType!];
        const newItem: ParsedItem = {
            _selected: true,
            _confidence: 1.0,
            _errors: [],
        };

        // Initialize required fields with empty values
        config.requiredFields.forEach(field => {
            newItem[field] = '';
        });

        setParsedData(prev => [...prev, newItem]);
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

        // Prepare data for saving
        const additionalData: Record<string, unknown> = {};
        if (entityType === 'products' && selectedProjectId) {
            additionalData.Project_ID = selectedProjectId;
        }

        const preparedItems = prepareForSave(selectedItems, entityType, additionalData);

        // Save each item using existing save functions
        for (let i = 0; i < preparedItems.length; i++) {
            const item = preparedItems[i];

            try {
                let saveResult: { success: boolean; message: string };

                switch (entityType) {
                    case 'materials':
                        saveResult = await saveMaterial(item as Partial<Material>, organizationId);
                        break;
                    case 'products':
                        saveResult = await saveProduct(item as Partial<Product>, organizationId);
                        break;
                    case 'workers':
                        saveResult = await saveWorker(item as Partial<Worker>, organizationId);
                        break;
                    case 'suppliers':
                        saveResult = await saveSupplier(item as Partial<Supplier>, organizationId);
                        break;
                    case 'projects':
                        saveResult = await saveProject(item as Partial<Project>, organizationId);
                        break;
                    default:
                        saveResult = { success: false, message: 'Nepoznat tip entiteta' };
                }

                if (saveResult.success) {
                    results.success++;
                } else {
                    results.failed++;
                    results.errors.push(`Red ${i + 1}: ${saveResult.message}`);
                }
            } catch (error) {
                results.failed++;
                results.errors.push(`Red ${i + 1}: ${error instanceof Error ? error.message : 'Nepoznata greška'}`);
            }

            setImportProgress({ current: i + 1, total: selectedItems.length });
        }

        setImportResults(results);
        setIsImporting(false);
        setStep(5);

        if (onImportComplete) {
            onImportComplete();
        }
    };

    // Get field input type
    const getFieldInput = (field: string, value: unknown, index: number) => {
        const config = ENTITY_CONFIGS[entityType!];
        const enumValues = config.enumFields?.[field];

        if (enumValues) {
            return (
                <select
                    value={(value as string) || ''}
                    onChange={(e) => updateField(index, field, e.target.value)}
                    className="ai-import-input"
                >
                    <option value="">Odaberi...</option>
                    {enumValues.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            );
        }

        if (field.toLowerCase().includes('price') ||
            field.toLowerCase().includes('rate') ||
            field.toLowerCase().includes('height') ||
            field.toLowerCase().includes('width') ||
            field.toLowerCase().includes('depth') ||
            field.toLowerCase().includes('quantity')) {
            return (
                <input
                    type="number"
                    value={(value as number) ?? ''}
                    onChange={(e) => updateField(index, field, parseFloat(e.target.value) || 0)}
                    className="ai-import-input"
                    step="0.01"
                />
            );
        }

        return (
            <input
                type="text"
                value={(value as string) || ''}
                onChange={(e) => updateField(index, field, e.target.value)}
                className="ai-import-input"
            />
        );
    };

    // Column resize handlers
    const handleResizeStart = (field: string, e: React.MouseEvent) => {
        e.preventDefault();
        setResizingColumn(field);
        setResizeStartX(e.clientX);
        setResizeStartWidth(columnWidths[field] || 150);
    };

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!resizingColumn) return;
        const diff = e.clientX - resizeStartX;
        const newWidth = Math.max(80, resizeStartWidth + diff);
        setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    }, [resizingColumn, resizeStartX, resizeStartWidth]);

    const handleResizeEnd = useCallback(() => {
        setResizingColumn(null);
    }, []);

    // Add/remove resize event listeners
    useEffect(() => {
        if (resizingColumn) {
            document.addEventListener('mousemove', handleResizeMove);
            document.addEventListener('mouseup', handleResizeEnd);
            return () => {
                document.removeEventListener('mousemove', handleResizeMove);
                document.removeEventListener('mouseup', handleResizeEnd);
            };
        }
    }, [resizingColumn, handleResizeMove, handleResizeEnd]);

    // Render step content
    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div className="ai-import-entity-selection">
                        <p className="ai-import-instruction">Odaberite vrstu podataka za import:</p>
                        <div className="ai-import-entity-grid">
                            {(Object.entries(ENTITY_CONFIGS) as [ImportEntityType, typeof ENTITY_CONFIGS[ImportEntityType]][]).map(([type, config]) => (
                                <button
                                    key={type}
                                    className="ai-import-entity-card"
                                    onClick={() => handleSelectEntityType(type)}
                                >
                                    <span className="ai-import-entity-icon">{config.icon}</span>
                                    <span className="ai-import-entity-name">{config.namePlural}</span>
                                    <span className="ai-import-entity-desc">{config.description}</span>
                                    <span className="ai-import-entity-fields">
                                        Polja: {config.exampleFields.join(', ')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                );

            case 1.5:
                return (
                    <div className="ai-import-project-selection">
                        <p className="ai-import-instruction">
                            Proizvodi se dodaju u projekat. Odaberite projekat:
                        </p>
                        {projects.length === 0 ? (
                            <div className="ai-import-empty">
                                <span className="material-icons-round">folder_off</span>
                                <p>Nemate nijedan projekat. Kreirajte projekat prvo.</p>
                            </div>
                        ) : (
                            <div className="ai-import-project-list">
                                {projects.map((project) => (
                                    <button
                                        key={project.Project_ID}
                                        className="ai-import-project-card"
                                        onClick={() => handleSelectProject(project.Project_ID)}
                                    >
                                        <span className="ai-import-project-name">{project.Client_Name}</span>
                                        <span className="ai-import-project-address">{project.Address || 'Bez adrese'}</span>
                                        <span className={`status-badge status-${project.Status.toLowerCase().replace(/\s+/g, '-')}`}>
                                            {project.Status}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            className="btn btn-secondary"
                            onClick={() => setStep(1)}
                        >
                            <span className="material-icons-round">arrow_back</span>
                            Nazad
                        </button>
                    </div>
                );

            case 2:
                return (
                    <div className="ai-import-upload">
                        {analysisError && (
                            <div className="ai-import-error" style={{ marginBottom: '16px' }}>
                                <span className="material-icons-round">error</span>
                                <p>{analysisError}</p>
                            </div>
                        )}

                        <div className="ai-import-selected-type">
                            <span className="ai-import-type-badge">
                                {entityType && ENTITY_CONFIGS[entityType].icon} {entityType && ENTITY_CONFIGS[entityType].namePlural}
                            </span>
                            {entityType === 'products' && selectedProjectId && (
                                <span className="ai-import-project-badge">
                                    → {projects.find(p => p.Project_ID === selectedProjectId)?.Client_Name}
                                </span>
                            )}
                        </div>

                        <div
                            className={`ai-import-dropzone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv,.txt,.pdf,.docx,.xlsx,.xls"
                                onChange={handleFileSelect}
                                hidden
                            />
                            {file ? (
                                <div className="ai-import-file-info">
                                    <span className="material-icons-round">description</span>
                                    <span className="file-name">{file.name}</span>
                                    <span className="file-size">({(file.size / 1024).toFixed(1)} KB)</span>
                                    <button
                                        className="file-remove"
                                        onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                    >
                                        <span className="material-icons-round">close</span>
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <span className="material-icons-round">cloud_upload</span>
                                    <p>Povucite datoteku ovdje ili kliknite za odabir</p>
                                    <span className="ai-import-formats">
                                        Podržani formati: CSV, TXT, PDF, DOCX, XLSX
                                    </span>
                                </>
                            )}
                        </div>

                        <div className="ai-import-divider">
                            <span>ILI</span>
                        </div>

                        <div className="ai-import-text-input">
                            <label>Zalijepite tekst direktno:</label>
                            <textarea
                                value={textContent}
                                onChange={(e) => { setTextContent(e.target.value); setFile(null); }}
                                placeholder="Zalijepite podatke ovdje (tabela, lista, tekst...)..."
                                rows={6}
                            />
                        </div>

                        <div className="ai-import-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setStep(entityType === 'products' ? 1.5 : 1)}
                            >
                                <span className="material-icons-round">arrow_back</span>
                                Nazad
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAnalyze}
                                disabled={!file && !textContent.trim()}
                            >
                                <span className="material-icons-round">auto_awesome</span>
                                Analiziraj sa AI
                            </button>
                        </div>
                    </div>
                );

            case 3:
                return (
                    <div className="ai-import-analyzing">
                        <div className="ai-import-loader">
                            <div className="spinner"></div>
                            <p>AI analizira sadržaj...</p>
                            <span className="ai-import-loader-hint">Ovo može potrajati nekoliko sekundi</span>
                        </div>
                    </div>
                );

            case 4:
                if (!entityType) return null;
                const config = ENTITY_CONFIGS[entityType];
                const allFields = [...config.requiredFields, ...config.optionalFields];
                const selectedCount = parsedData.filter(item => item._selected).length;

                return (
                    <div className="ai-import-preview">
                        {warnings.length > 0 && (
                            <div className="ai-import-warnings">
                                <span className="material-icons-round">warning</span>
                                <ul>
                                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        )}

                        {analysisError && (
                            <div className="ai-import-error">
                                <span className="material-icons-round">error</span>
                                <p>{analysisError}</p>
                            </div>
                        )}

                        <div className="ai-import-table-header">
                            <span>Pronađeno {parsedData.length} zapisa, odabrano {selectedCount}</span>
                            <button className="btn btn-sm btn-secondary" onClick={addNewRow}>
                                <span className="material-icons-round">add</span>
                                Dodaj red
                            </button>
                        </div>

                        <div className="ai-import-table-wrapper">
                            <table className="ai-import-table">
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
                                        {allFields.map(field => (
                                            <th
                                                key={field}
                                                style={{
                                                    width: columnWidths[field] || 150,
                                                    minWidth: 80,
                                                    position: 'relative'
                                                }}
                                            >
                                                <div className="th-content">
                                                    <span className="th-label">
                                                        {field.replace(/_/g, ' ')}
                                                        {config.requiredFields.includes(field) && <span className="required">*</span>}
                                                    </span>
                                                    <div
                                                        className="resize-handle"
                                                        onMouseDown={(e) => handleResizeStart(field, e)}
                                                    />
                                                </div>
                                            </th>
                                        ))}
                                        <th className="col-confidence">Pouzdanost</th>
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
                                            {allFields.map(field => (
                                                <td key={field}>
                                                    {getFieldInput(field, item[field], index)}
                                                </td>
                                            ))}
                                            <td className="col-confidence">
                                                <span className={`confidence-badge ${(item._confidence || 0) >= 0.8 ? 'high' :
                                                    (item._confidence || 0) >= 0.5 ? 'medium' : 'low'
                                                    }`}>
                                                    {Math.round((item._confidence || 0) * 100)}%
                                                </span>
                                            </td>
                                            <td className="col-actions">
                                                <button
                                                    className="icon-btn danger"
                                                    onClick={() => deleteRow(index)}
                                                >
                                                    <span className="material-icons-round">delete</span>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="ai-import-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setStep(2)}
                            >
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

            case 5:
                return (
                    <div className="ai-import-results">
                        {isImporting ? (
                            <div className="ai-import-progress">
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
                                <div className={`ai-import-result-summary ${importResults.failed > 0 ? 'has-errors' : 'success'}`}>
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
                                    <div className="ai-import-errors">
                                        <h4>Greške:</h4>
                                        <ul>
                                            {importResults.errors.map((err, i) => (
                                                <li key={i}>{err}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div className="ai-import-actions">
                                    <button
                                        className="btn btn-secondary"
                                        onClick={resetWizard}
                                    >
                                        <span className="material-icons-round">refresh</span>
                                        Novi import
                                    </button>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleClose}
                                    >
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

    // Calculate current step for progress indicator
    const getProgressStep = () => {
        if (step === 1 || step === 1.5) return 1;
        if (step === 2) return 2;
        if (step === 3) return 3;
        if (step === 4) return 4;
        return 5;
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={
                <div className="ai-import-header">
                    <span className="material-icons-round">auto_awesome</span>
                    <span>AI Import Wizard</span>
                </div>
            }
            size="xl"
        >
            <div className="ai-import-wizard">
                {/* Progress Steps */}
                <div className="ai-import-steps">
                    {['Odabir tipa', 'Upload', 'Analiza', 'Pregled', 'Import'].map((label, index) => (
                        <div
                            key={index}
                            className={`ai-import-step ${getProgressStep() === index + 1 ? 'active' : ''} ${getProgressStep() > index + 1 ? 'completed' : ''}`}
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
                <div className="ai-import-content">
                    {step === 3 && isAnalyzing ? (
                        <div className="ai-import-analyzing">
                            <div className="ai-import-loader">
                                <div className="spinner"></div>
                                <p>AI analizira sadržaj...</p>
                                <span className="ai-import-loader-hint">Ovo može potrajati nekoliko sekundi</span>
                            </div>
                        </div>
                    ) : (
                        renderStepContent()
                    )}
                </div>
            </div>
        </Modal>
    );
}
