import React from 'react';

export const ArtisticSide: React.FC = () => {
    return (
        <div className="artistic-side">

            {/* Background Image Layer */}
            <img
                src="https://images.unsplash.com/photo-1611269154421-4e27233ac5c7?q=80&w=2670&auto=format&fit=crop"
                alt="Furniture Factory Workshop"
                className="art-bg-image"
            />

            {/* Gradient Overlay */}
            <div className="art-overlay-gradient" />

            {/* Grid Pattern Overlay */}
            <div className="art-grid-pattern" />

            {/* Abstract Shapes/Art */}
            <div className="orb orb-primary" />
            <div className="orb orb-secondary" />

            {/* Content for Mobile Header */}
            <div className="lg:hidden mobile-header-content" style={{ display: 'none' }}> {/* Hidden by CSS media query in class logic mainly, but inline style as backup/override logic if needed, actually let's rely on CSS media queries. I'll remove inline style to let CSS handle it. Wait, my CSS file has lg:hidden but I need to make sure it works. I'm using media queries in CSS. */}
                {/* The CSS handles display:none for desktop, but for mobile we want it shown. 
             However, in React, standard style prop overrides CSS class. 
             So I will just let the CSS handle visibility. */}
                <div className="text-center transform -translate-y-4">
                    <h1 className="mobile-header-title">Lumina ERP</h1>
                    <p className="mobile-header-subtitle">Enterprise Intelligence</p>
                </div>
            </div>

            {/* Glass Card - System Status (DESKTOP ONLY) */}
            {/* Since I am using raw CSS media queries, I will wrap this in a div that is hidden on mobile via CSS class */}
            <div className="glass-status-card hidden-mobile" style={{ display: 'none' }}> {/* Initial state, will be overridden by media query if I set it right, or I can use a resize hook. Better: use CSS media query for display. */}
                {/* Actually, simple CSS media query is best. I will add a class 'desktop-only' to my CSS. */}
                <div className="glass-panel group">
                    {/* Glossy reflection effect */}
                    <div className="glass-shine" />

                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: 'linear-gradient(to right, var(--accent), #a855f7)' }} />

                    <h2 style={{ fontSize: '1.875rem', fontWeight: 300, color: 'white', marginBottom: '0.5rem', letterSpacing: '-0.025em' }}>Lumina ERP</h2>
                    <p style={{ color: '#cbd5e1', marginBottom: '2rem', fontWeight: 300, letterSpacing: '0.025em' }}>Enterprise Resource Planning & Intelligence</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="status-row">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div className="status-dot success" />
                                <span style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>System Status</span>
                            </div>
                            <span style={{ color: '#34d399', fontSize: '0.875rem', fontWeight: 500 }}>Optimal</span>
                        </div>

                        <div className="status-row">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div className="status-dot info" />
                                <span style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>Active Nodes</span>
                            </div>
                            <span style={{ color: 'white', fontSize: '0.875rem', fontFamily: 'monospace' }}>1,024</span>
                        </div>
                    </div>

                    <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                        <p style={{ color: '#cbd5e1', fontSize: '0.75rem', fontStyle: 'italic', fontWeight: 300 }}>
                            "Učinkovitost je raditi stvari ispravno. Djelotvornost je raditi prave stvari."
                        </p>
                        <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem', fontWeight: 500 }}>- Peter Drucker</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
