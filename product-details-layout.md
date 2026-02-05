<!DOCTYPE html>
<html lang="hr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Organized Product Details</title>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet">
    <style>
        :root {
            --bg-page: #f5f5f7;
            --bg-card: #ffffff;
            --bg-subtle: #f9f9fa;
            --border-light: #e5e5ea;
            
            --text-primary: #1c1c1e;
            --text-secondary: #86868b;
            --text-accent: #007aff;
            
            --input-radius: 8px;
            --card-radius: 16px;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 40px;
            background-color: var(--bg-page);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: var(--text-primary);
        }

        /* --- GLAVNA KARTICA --- */
        .main-card {
            width: 100%;
            max-width: 680px;
            background: var(--bg-card);
            border-radius: var(--card-radius);
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
            overflow: hidden; /* Da footer ne probije radius */
            border: 1px solid rgba(0,0,0,0.03);
        }

        .card-body {
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        /* --- ZAJEDNIČKI STILOVI --- */
        .section-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-secondary);
            margin-bottom: 8px;
            display: block;
        }

        .data-container {
            background: var(--bg-subtle);
            border: 1px solid var(--border-light);
            border-radius: 12px;
            padding: 16px;
        }

        /* --- INPUT POLJA --- */
        .clean-input {
            border: 1px solid transparent;
            background: white;
            border-radius: var(--input-radius);
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary);
            text-align: center;
            padding: 8px 4px;
            width: 100%;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
            transition: all 0.2s;
        }

        .clean-input:focus {
            border-color: var(--text-accent);
            outline: none;
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
        }

        /* --- GORNJI RED: MARŽA I RAD --- */
        .top-grid {
            display: grid;
            grid-template-columns: 120px 1fr;
            gap: 16px;
        }

        /* Marža */
        .margin-box {
            display: flex;
            flex-direction: column;
            justify-content: center;
            text-align: center;
        }
        
        .margin-input-wrapper {
            position: relative;
        }
        
        .margin-suffix {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 11px;
            color: var(--text-secondary);
            pointer-events: none;
        }

        /* Labor Box */
        .labor-box {
            display: flex;
            flex-direction: column;
        }

        .labor-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr auto;
            align-items: center;
            gap: 12px;
        }

        .labor-col {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .labor-col span {
            font-size: 10px;
            color: var(--text-secondary);
            font-weight: 500;
            text-transform: uppercase;
            text-align: center;
        }

        .labor-result {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: center;
            padding-left: 12px;
            border-left: 1px solid var(--border-light);
            height: 100%;
        }

        .labor-result-val {
            font-size: 15px;
            font-weight: 700;
            color: var(--text-accent);
        }
        
        .labor-result-label {
            font-size: 10px;
            color: var(--text-secondary);
        }

        /* --- DODACI (EXTRAS) --- */
        .extras-wrapper {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 6px 6px 12px;
            background: white;
            border: 1px solid var(--border-light);
            border-radius: 20px;
            font-size: 13px;
            color: var(--text-primary);
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            transition: all 0.2s;
        }

        .chip:hover {
            border-color: var(--text-secondary);
        }

        .chip-price {
            font-weight: 600;
            color: var(--text-accent);
            font-size: 12px;
        }

        .chip-remove {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #f2f2f7;
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: var(--text-secondary);
            padding: 0;
        }

        .chip-remove:hover {
            background: #ff3b30;
            color: white;
        }

        .btn-add-extra {
            background: transparent;
            border: 1px dashed var(--text-secondary);
            color: var(--text-secondary);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .btn-add-extra:hover {
            border-color: var(--text-accent);
            color: var(--text-accent);
            background: rgba(0, 122, 255, 0.05);
        }

        /* --- FOOTER --- */
        .card-footer {
            background: #fafafa;
            border-top: 1px solid var(--border-light);
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .total-label {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
        }

        .total-amount {
            font-size: 22px;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.5px;
        }

        /* --- RESPONSIVE --- */
        @media (max-width: 600px) {
            .top-grid {
                grid-template-columns: 1fr;
            }
            .labor-grid {
                grid-template-columns: 1fr 1fr 1fr;
            }
            .labor-result {
                grid-column: 1 / -1;
                border-left: none;
                border-top: 1px solid var(--border-light);
                padding-left: 0;
                padding-top: 12px;
                margin-top: 4px;
                align-items: center;
                flex-direction: row;
                justify-content: space-between;
                width: 100%;
            }
            .labor-result-label {
                order: 1;
            }
            .labor-result-val {
                order: 2;
            }
        }
    </style>
</head>
<body>

    <div class="main-card">
        
        <div class="card-body">
            
            <!-- ROW 1: INPUTS -->
            <div class="top-grid">
                
                <!-- COLUMN 1: MARGIN -->
                <div class="margin-box data-container">
                    <span class="section-label" style="text-align: center;">Marža</span>
                    <div class="margin-input-wrapper">
                        <input type="number" class="clean-input" value="120" placeholder="0">
                        <span class="margin-suffix">KM</span>
                    </div>
                </div>

                <!-- COLUMN 2: LABOR -->
                <div class="labor-box data-container">
                    <span class="section-label">Troškovi Rada</span>
                    
                    <div class="labor-grid">
                        <!-- Input 1 -->
                        <div class="labor-col">
                            <input type="number" class="clean-input" value="2">
                            <span>Radnika</span>
                        </div>
                        
                        <!-- Input 2 -->
                        <div class="labor-col">
                            <input type="number" class="clean-input" value="3">
                            <span>Dana</span>
                        </div>

                        <!-- Input 3 -->
                        <div class="labor-col">
                            <input type="number" class="clean-input" value="25">
                            <span>Dnevnica</span>
                        </div>

                        <!-- Calculated Total for Labor -->
                        <div class="labor-result">
                            <span class="labor-result-val">150 KM</span>
                            <span class="labor-result-label">Ukupno rad</span>
                        </div>
                    </div>
                </div>

            </div>

            <!-- ROW 2: EXTRAS -->
            <div class="extras-section">
                <span class="section-label">Dodatne Usluge</span>
                <div class="extras-wrapper">
                    
                    <!-- Item -->
                    <div class="chip">
                        <span>Montaža</span>
                        <span class="chip-price">50 KM</span>
                        <button class="chip-remove">
                            <span class="material-icons-round" style="font-size: 14px;">close</span>
                        </button>
                    </div>

                    <!-- Item -->
                    <div class="chip">
                        <span>Transport</span>
                        <span class="chip-price">20 KM</span>
                        <button class="chip-remove">
                            <span class="material-icons-round" style="font-size: 14px;">close</span>
                        </button>
                    </div>

                    <!-- Add Button -->
                    <button class="btn-add-extra">
                        <span class="material-icons-round" style="font-size: 16px;">add</span>
                        Dodaj uslugu
                    </button>
                </div>
            </div>

        </div>

        <!-- FOOTER: TOTAL -->
        <div class="card-footer">
            <span class="total-label">Ukupna cijena</span>
            <span class="total-amount">340.00 KM</span>
        </div>

    </div>

</body>
</html>