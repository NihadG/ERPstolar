'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PRICING_PLANS = [
    {
        id: 'free',
        name: 'Free',
        price: '0',
        period: 'zauvijek',
        description: 'Idealno za početnike',
        features: [
            'Upravljanje projektima',
            'Upravljanje proizvodima',
            'Katalog materijala',
            'Evidencija radnika',
            'Evidencija dobavljača',
            'Neograničeno projekata',
        ],
        notIncluded: [
            'Modul Ponude',
            'Modul Narudžbe',
            'Izvještaji',
            'API pristup',
        ],
        cta: 'Trenutni plan',
        popular: false,
    },
    {
        id: 'professional',
        name: 'Professional',
        price: '29',
        period: 'mjesečno',
        description: 'Za aktivne stolarske radionice',
        features: [
            'Sve iz Free plana',
            '✨ Modul Ponude',
            'Kreiranje ponuda',
            'PDF export ponuda',
            'Praćenje statusa ponuda',
            'Email podrška',
        ],
        notIncluded: [
            'Modul Narudžbe',
            'Izvještaji',
            'API pristup',
        ],
        cta: 'Nadogradi',
        popular: true,
    },
    {
        id: 'enterprise',
        name: 'Enterprise',
        price: '49',
        period: 'mjesečno',
        description: 'Kompletno rješenje za proizvodnju',
        features: [
            'Sve iz Professional plana',
            '✨ Modul Ponude',
            '✨ Modul Narudžbe',
            'Upravljanje narudžbama',
            'Praćenje isporuka',
            'Izvještaji',
            'Prioritetna podrška',
        ],
        notIncluded: [],
        cta: 'Nadogradi',
        popular: false,
    },
];

export default function PricingPage() {
    const { organization, user } = useAuth();
    const router = useRouter();
    const currentPlan = organization?.Subscription_Plan || 'free';

    const handleSelectPlan = (planId: string) => {
        if (planId === currentPlan) return;

        // TODO: Integrate with Stripe for payment
        alert(`Stripe integracija za plan "${planId}" će biti implementirana.\n\nKontaktirajte nas na email za aktivaciju.`);
    };

    return (
        <div className="pricing-page">
            <nav className="pricing-nav">
                <Link href="/" className="back-button" style={{
                    textDecoration: 'none',
                    color: 'white',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 20px',
                    borderRadius: '50px',
                    background: 'rgba(255, 255, 255, 0.15)',
                    backdropFilter: 'blur(10px)',
                    fontSize: '14px',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                }}>
                    <span className="material-icons-round" style={{ fontSize: '20px' }}>arrow_back</span>
                    <span>Nazad na aplikaciju</span>
                </Link>
            </nav>

            <div className="pricing-header">
                <h1>Odaberite plan za vašu firmu</h1>
                <p>Svi planovi uključuju neograničen broj projekata i korisnika</p>
            </div>

            <div className="pricing-cards">
                {PRICING_PLANS.map((plan) => (
                    <div
                        key={plan.id}
                        className={`pricing-card ${plan.popular ? 'popular' : ''} ${currentPlan === plan.id ? 'current' : ''}`}
                    >
                        {plan.popular && <div className="popular-badge">Najpopularniji</div>}
                        {currentPlan === plan.id && <div className="current-badge">Vaš plan</div>}

                        <h2>{plan.name}</h2>
                        <p className="plan-description">{plan.description}</p>

                        <div className="plan-price">
                            <span className="currency">€</span>
                            <span className="amount">{plan.price}</span>
                            <span className="period">/{plan.period}</span>
                        </div>

                        <ul className="plan-features">
                            {plan.features.map((feature, i) => (
                                <li key={i} className="included">
                                    <span className="material-icons-round">check_circle</span>
                                    {feature}
                                </li>
                            ))}
                            {plan.notIncluded.map((feature, i) => (
                                <li key={i} className="not-included">
                                    <span className="material-icons-round">cancel</span>
                                    {feature}
                                </li>
                            ))}
                        </ul>

                        <button
                            className={`plan-cta ${currentPlan === plan.id ? 'disabled' : ''}`}
                            onClick={() => handleSelectPlan(plan.id)}
                            disabled={currentPlan === plan.id}
                        >
                            {currentPlan === plan.id ? 'Trenutni plan' : plan.cta}
                        </button>
                    </div>
                ))}
            </div>

            <div className="pricing-footer">
                <p>Imate pitanja? <a href="mailto:support@example.com">Kontaktirajte nas</a></p>
            </div>

            <style jsx>{`
                .pricing-page {
                    min-height: 100vh;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 24px;
                }

                .pricing-nav {
                    max-width: 1200px;
                    margin: 0 auto 40px;
                }

                .back-button {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    color: white;
                    text-decoration: none !important;
                    font-size: 14px;
                    font-weight: 600;
                    padding: 10px 20px;
                    borderRadius: 50px;
                    background: rgba(255, 255, 255, 0.15);
                    backdropFilter: blur(10px);
                    transition: all 0.2s;
                }

                .back-button:hover,
                a.back-button:hover {
                    background: rgba(255, 255, 255, 0.25);
                    transform: translateX(-2px);
                }

                .pricing-header {
                    text-align: center;
                    color: white;
                    margin-bottom: 48px;
                }

                .pricing-header h1 {
                    font-size: 36px;
                    font-weight: 700;
                    margin-bottom: 12px;
                }

                .pricing-header p {
                    font-size: 18px;
                    opacity: 0.9;
                }

                .pricing-cards {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 24px;
                    max-width: 1200px;
                    margin: 0 auto;
                }

                .pricing-card {
                    background: white;
                    border-radius: 20px;
                    padding: 32px;
                    position: relative;
                    transition: transform 0.2s, box-shadow 0.2s;
                }

                .pricing-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
                }

                .pricing-card.popular {
                    border: 3px solid #667eea;
                    transform: scale(1.02);
                }

                .pricing-card.current {
                    border: 3px solid #34c759;
                }

                .popular-badge {
                    position: absolute;
                    top: -12px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 6px 20px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .current-badge {
                    position: absolute;
                    top: -12px;
                    right: 20px;
                    background: #34c759;
                    color: white;
                    padding: 6px 16px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .pricing-card h2 {
                    font-size: 24px;
                    margin-bottom: 8px;
                }

                .plan-description {
                    color: #86868b;
                    font-size: 14px;
                    margin-bottom: 24px;
                }

                .plan-price {
                    display: flex;
                    align-items: baseline;
                    gap: 4px;
                    margin-bottom: 24px;
                }

                .plan-price .currency {
                    font-size: 24px;
                    font-weight: 600;
                    color: #1d1d1f;
                }

                .plan-price .amount {
                    font-size: 48px;
                    font-weight: 700;
                    color: #1d1d1f;
                }

                .plan-price .period {
                    font-size: 16px;
                    color: #86868b;
                }

                .plan-features {
                    list-style: none;
                    padding: 0;
                    margin: 0 0 32px 0;
                }

                .plan-features li {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 0;
                    font-size: 14px;
                    border-bottom: 1px solid #f5f5f7;
                }

                .plan-features li:last-child {
                    border-bottom: none;
                }

                .plan-features li.included .material-icons-round {
                    color: #34c759;
                    font-size: 20px;
                }

                .plan-features li.not-included {
                    color: #aeaeb2;
                }

                .plan-features li.not-included .material-icons-round {
                    color: #aeaeb2;
                    font-size: 20px;
                }

                .plan-cta {
                    width: 100%;
                    padding: 16px;
                    border: none;
                    border-radius: 12px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }

                .plan-cta:hover:not(.disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
                }

                .plan-cta.disabled {
                    background: #e8e8ed;
                    color: #86868b;
                    cursor: default;
                }

                .pricing-footer {
                    text-align: center;
                    margin-top: 48px;
                    color: white;
                }

                .pricing-footer a {
                    color: white;
                    font-weight: 600;
                }

                @media (max-width: 768px) {
                    .pricing-header h1 {
                        font-size: 28px;
                    }

                    .pricing-card.popular {
                        transform: none;
                    }
                }
            `}</style>
        </div >
    );
}
