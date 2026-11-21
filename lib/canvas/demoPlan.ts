// ════════════════════════════════════════════════════════════════════
// DEMO PLAN za /canvas-preview (samo razvoj).
//
// Oblik je preuzet iz stvarnog plana radionice (41 nalog, 4 projekta, 7 parova,
// subotnje smjene A/B, kratki i dugi nalozi, dan predaje i jedno stvarno
// preklapanje) — ali su IMENA LJUDI I PROJEKATA IZMIŠLJENA i ID-jevi novi.
// Generisano skriptom iz izvoza; ne uređivati ručno osim imena.
// ════════════════════════════════════════════════════════════════════

import type { PlanScenario, PlanBlock, Worker, Project, WorkOrder, WorkerAttendance } from '../types';

const W = (id: string, name: string, anchor: string | null): Worker => ({
    Worker_ID: id, Name: name, Role: 'Opći', Worker_Type: 'Glavni', Status: 'Aktivan',
    ...(anchor ? { Saturday_Anchor: anchor } : {}),
} as Worker);

export const demoCanvasWorkers: Worker[] = [
    W('demo-w01', 'Ismet Dedić', '2026-11-28'),
    W('demo-w02', 'Almir Hadžić', '2026-11-21'),
    W('demo-w03', 'Avdo Hasić', '2026-11-28'),
    W('demo-w04', 'Elvir Zukić', '2026-11-28'),
    W('demo-w05', 'Rifat Mehić', '2026-11-21'),
    W('demo-w06', 'Sanel Avdić', '2026-11-28'),
    W('demo-w07', 'Nedžad Kovač', '2026-11-21'),
    W('demo-w08', 'Brane Karić', '2026-11-21'),
    W('demo-w09', 'Neven Ibrić', '2026-11-21'),
    W('demo-w10', 'Kenan Mehić', '2026-11-21'),
    W('demo-w11', 'Asim Beširević', '2026-11-28'),
    W('demo-w12', 'Begzudin Sejdić', '2026-11-21'),
    W('demo-w13', 'Adnan Pašić', '2026-11-28'),
    W('demo-w14', 'Dino Lasić', '2026-11-21'),
    W('demo-w15', 'Mirza Kolar', '2026-11-28'),
    W('demo-w16', 'Mirsad Omerović', '2026-11-28'),
    W('demo-w17', 'Esad Turković', '2026-11-21'),
];

export const demoCanvasProjects: Project[] = [
    { Project_ID: 'demo-p-jezero', Name: 'Hotel Jezero', Client_Name: 'Hotel Jezero' } as Project,
    { Project_ID: 'demo-p-planina', Name: 'Hotel Planina', Client_Name: 'Hotel Planina' } as Project,
    { Project_ID: 'demo-p-maric', Name: 'Stan Marić - B2 204', Client_Name: 'Stan Marić - B2 204' } as Project,
    { Project_ID: 'demo-p-atrij', Name: 'Atrij Residence - Recepcija', Client_Name: 'Atrij Residence - Recepcija' } as Project,
];

const blocks: PlanBlock[] = [
    {
        id: 'demo-b01',
        kind: 'order',
        title: 'Poz 3 - Noćni ormarići 550 · Hotel Planina',
        startISO: '2026-12-17',
        endISO: '2026-12-17',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c1-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c1-1'
    },
    {
        id: 'demo-b02',
        kind: 'order',
        title: 'Poz 7.1 - Umivaonici (apartmani) · Hotel Planina',
        startISO: '2027-01-08',
        endISO: '2027-01-11',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w09',
                name: 'Neven Ibrić'
            },
            {
                id: 'demo-w17',
                name: 'Esad Turković'
            }
        ],
        workerDays: 3,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c2-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c2-1'
    },
    {
        id: 'demo-b03',
        kind: 'order',
        title: 'Poz 6 - Ogledalo (iste sobe) · Hotel Planina',
        startISO: '2026-12-10',
        endISO: '2026-12-15',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 7,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c3-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c3-1'
    },
    {
        id: 'demo-b04',
        kind: 'order',
        title: 'Poz 7.2 - Umivaonici 1800 · Hotel Planina',
        startISO: '2027-01-12',
        endISO: '2027-01-12',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w09',
                name: 'Neven Ibrić'
            },
            {
                id: 'demo-w17',
                name: 'Esad Turković'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c4-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c4-1'
    },
    {
        id: 'demo-b05',
        kind: 'order',
        title: 'Poz 3.1 - Noćni ormarići 750 · Hotel Planina',
        startISO: '2026-12-18',
        endISO: '2026-12-18',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c5-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c5-1'
    },
    {
        id: 'demo-b06',
        kind: 'order',
        title: 'Poz 7 - Umivaonici · Hotel Planina',
        startISO: '2027-01-05',
        endISO: '2027-01-08',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w09',
                name: 'Neven Ibrić'
            },
            {
                id: 'demo-w17',
                name: 'Esad Turković'
            }
        ],
        workerDays: 7,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c6-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c6-1'
    },
    {
        id: 'demo-b07',
        kind: 'order',
        title: 'Poz 4 - Ormar na ulazu · Hotel Planina',
        startISO: '2026-12-14',
        endISO: '2026-12-22',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w01',
                name: 'Ismet Dedić'
            },
            {
                id: 'demo-w13',
                name: 'Adnan Pašić'
            }
        ],
        workerDays: 14,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c7-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c7-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c7-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c7-3'
    },
    {
        id: 'demo-b08',
        kind: 'order',
        title: 'Poz 2 - Kreveti 900 · Hotel Planina',
        startISO: '2026-12-15',
        endISO: '2026-12-16',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 3,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c8-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c8-1'
    },
    {
        id: 'demo-b09',
        kind: 'order',
        title: 'Poz 5 - Polica za TV · Hotel Planina',
        startISO: '2026-12-03',
        endISO: '2026-12-12',
        projectRef: {
            id: 'demo-p-planina',
            name: 'Hotel Planina'
        },
        workerRefs: [
            {
                id: 'demo-w01',
                name: 'Ismet Dedić'
            },
            {
                id: 'demo-w13',
                name: 'Adnan Pašić'
            }
        ],
        workerDays: 15,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c9-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c9-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c9-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c9-3'
    },
    {
        id: 'demo-b10',
        kind: 'order',
        title: 'Poz 3.1 - Ostrvo · Marić stan',
        startISO: '2027-01-04',
        endISO: '2027-01-11',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 10,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c10-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c10-2',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c10-2'
    },
    {
        id: 'demo-b11',
        kind: 'order',
        title: 'Poz 5 - Konzola u hodniku · Marić stan',
        startISO: '2026-12-24',
        endISO: '2027-01-03',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 16,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c11-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c11-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c11-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c11-3'
    },
    {
        id: 'demo-b12',
        kind: 'order',
        title: 'Poz 7.7 - Obloga · Marić stan',
        startISO: '2027-01-12',
        endISO: '2027-01-13',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c12-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c12-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c12-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c12-3'
    },
    {
        id: 'demo-b13',
        kind: 'order',
        title: 'Poz 6 - Obloge u hodniku · Marić stan',
        startISO: '2026-12-07',
        endISO: '2026-12-07',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w16',
                name: 'Mirsad Omerović'
            },
            {
                id: 'demo-w03',
                name: 'Avdo Hasić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c13-1',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c13-1'
    },
    {
        id: 'demo-b14',
        kind: 'order',
        title: 'Poz 2 - Zid iza sofe · Marić stan',
        startISO: '2027-01-07',
        endISO: '2027-01-11',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 6,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c14-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c14-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c14-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c14-3'
    },
    {
        id: 'demo-b15',
        kind: 'order',
        title: 'Poz 3 - Kuhinja · Marić stan',
        startISO: '2026-12-12',
        endISO: '2026-12-23',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 20,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c15-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c15-2',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c15-2'
    },
    {
        id: 'demo-b16',
        kind: 'order',
        title: 'Poz 6.1 - Obloga u prolazu Hodnik - Dnevna soba · Marić stan',
        startISO: '2026-11-30',
        endISO: '2026-12-02',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w16',
                name: 'Mirsad Omerović'
            },
            {
                id: 'demo-w03',
                name: 'Avdo Hasić'
            }
        ],
        workerDays: 6,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c16-1',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c16-1'
    },
    {
        id: 'demo-b17',
        kind: 'order',
        title: 'Poz 7.5- Vrata toalet spavaća · Marić stan',
        startISO: '2026-12-08',
        endISO: '2026-12-08',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w16',
                name: 'Mirsad Omerović'
            },
            {
                id: 'demo-w03',
                name: 'Avdo Hasić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c17-1',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c17-1'
    },
    {
        id: 'demo-b18',
        kind: 'order',
        title: 'Poz 4 - Hodnik · Marić stan',
        startISO: '2026-12-03',
        endISO: '2026-12-04',
        projectRef: {
            id: 'demo-p-maric',
            name: 'Stan Marić - B2 204'
        },
        workerRefs: [
            {
                id: 'demo-w16',
                name: 'Mirsad Omerović'
            },
            {
                id: 'demo-w03',
                name: 'Avdo Hasić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'medium',
        crewOptions: [
            {
                id: 'demo-c18-1',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c18-1'
    },
    {
        id: 'demo-b19',
        kind: 'order',
        title: 'Poz 1 - Recepcijski pult · Recepcija Atrij Residence',
        startISO: '2026-11-30',
        endISO: '2026-12-08',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w10',
                name: 'Kenan Mehić'
            },
            {
                id: 'demo-w05',
                name: 'Rifat Mehić'
            }
        ],
        workerDays: 14,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c19-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c19-1'
    },
    {
        id: 'demo-b20',
        kind: 'order',
        title: 'Poz 5 - Obloga sa kosinama · Recepcija Atrij Residence',
        startISO: '2026-11-30',
        endISO: '2026-12-17',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w09',
                name: 'Neven Ibrić'
            },
            {
                id: 'demo-w17',
                name: 'Esad Turković'
            }
        ],
        workerDays: 30,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c20-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c20-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c20-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c20-2'
    },
    {
        id: 'demo-b21',
        kind: 'order',
        title: 'Poz 6 - Velika obloga (desno od vjetrobrana) · Recepcija Atrij Residence',
        startISO: '2026-12-28',
        endISO: '2027-01-04',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w09',
                name: 'Neven Ibrić'
            },
            {
                id: 'demo-w17',
                name: 'Esad Turković'
            }
        ],
        workerDays: 10,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c21-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            },
            {
                id: 'demo-c21-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c21-2'
    },
    {
        id: 'demo-b22',
        kind: 'order',
        title: 'Poz 7 - Recepcija u Fitnesu · Recepcija Atrij Residence',
        startISO: '2026-12-09',
        endISO: '2026-12-20',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w10',
                name: 'Kenan Mehić'
            },
            {
                id: 'demo-w05',
                name: 'Rifat Mehić'
            }
        ],
        workerDays: 14,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c22-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c22-1'
    },
    {
        id: 'demo-b23',
        kind: 'order',
        title: 'Poz 4 - Obloge stubova · Recepcija Atrij Residence',
        startISO: '2026-12-21',
        endISO: '2027-01-11',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w10',
                name: 'Kenan Mehić'
            },
            {
                id: 'demo-w05',
                name: 'Rifat Mehić'
            }
        ],
        workerDays: 36,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c23-1',
                lead: {
                    id: 'demo-w10',
                    name: 'Kenan Mehić'
                },
                members: [
                    {
                        id: 'demo-w05',
                        name: 'Rifat Mehić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c23-1'
    },
    {
        id: 'demo-b24',
        kind: 'order',
        title: 'Poz 7.1 - Retropult recepcija Fitness · Recepcija Atrij Residence',
        startISO: '2026-12-18',
        endISO: '2026-12-25',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w09',
                name: 'Neven Ibrić'
            },
            {
                id: 'demo-w17',
                name: 'Esad Turković'
            }
        ],
        workerDays: 14,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c24-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c24-2',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c24-1'
    },
    {
        id: 'demo-b25',
        kind: 'order',
        title: 'Poz 2 - Retropult komoda · Recepcija Atrij Residence',
        startISO: '2026-11-30',
        endISO: '2026-12-05',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 6,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c25-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c25-2',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c25-2'
    },
    {
        id: 'demo-b26',
        kind: 'order',
        title: 'Poz 3 - Retropult City light · Recepcija Atrij Residence',
        startISO: '2026-12-06',
        endISO: '2026-12-11',
        projectRef: {
            id: 'demo-p-atrij',
            name: 'Atrij Residence - Recepcija'
        },
        workerRefs: [
            {
                id: 'demo-w08',
                name: 'Brane Karić'
            },
            {
                id: 'demo-w12',
                name: 'Begzudin Sejdić'
            }
        ],
        workerDays: 6,
        crew: 2,
        priority: 'urgent',
        crewOptions: [
            {
                id: 'demo-c26-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c26-2',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c26-2'
    },
    {
        id: 'demo-b27',
        kind: 'order',
        title: 'Poz 8 -Krevet · Hotel Jezero',
        startISO: '2026-12-02',
        endISO: '2026-12-02',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c27-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c27-1'
    },
    {
        id: 'demo-b28',
        kind: 'order',
        title: 'Poz 1 - El ormar · Hotel Jezero',
        startISO: '2026-12-03',
        endISO: '2026-12-03',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c28-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c28-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c28-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c28-1'
    },
    {
        id: 'demo-b29',
        kind: 'order',
        title: 'Poz 2 -Ormar · Hotel Jezero',
        startISO: '2026-12-04',
        endISO: '2026-12-04',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c29-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c29-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c29-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c29-1'
    },
    {
        id: 'demo-b30',
        kind: 'order',
        title: 'Poz 12 - Umivaonik · Hotel Jezero',
        startISO: '2026-11-30',
        endISO: '2026-12-01',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c30-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c30-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c30-1'
    },
    {
        id: 'demo-b31',
        kind: 'order',
        title: 'Poz 7 -Minibar · Hotel Jezero',
        startISO: '2026-12-02',
        endISO: '2026-12-02',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w01',
                name: 'Ismet Dedić'
            },
            {
                id: 'demo-w13',
                name: 'Adnan Pašić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c31-1',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c31-1'
    },
    {
        id: 'demo-b32',
        kind: 'order',
        title: 'Poz 11 - Vanjska obloga oko ulaznih vrata · Hotel Jezero',
        startISO: '2026-11-30',
        endISO: '2026-12-01',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w15',
                name: 'Mirza Kolar'
            },
            {
                id: 'demo-w06',
                name: 'Sanel Avdić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c32-1',
                lead: {
                    id: 'demo-w15',
                    name: 'Mirza Kolar'
                },
                members: [
                    {
                        id: 'demo-w06',
                        name: 'Sanel Avdić'
                    }
                ]
            },
            {
                id: 'demo-c32-2',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c32-1'
    },
    {
        id: 'demo-b33',
        kind: 'order',
        title: 'Poz 3 -Klupa sa oblogom · Hotel Jezero',
        startISO: '2026-12-05',
        endISO: '2026-12-05',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c33-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c33-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c33-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c33-1'
    },
    {
        id: 'demo-b34',
        kind: 'order',
        title: 'Poz 4 -Obloga bočnog zida · Hotel Jezero',
        startISO: '2026-12-03',
        endISO: '2026-12-03',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w01',
                name: 'Ismet Dedić'
            },
            {
                id: 'demo-w13',
                name: 'Adnan Pašić'
            }
        ],
        workerDays: 1,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c34-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c34-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c34-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c34-3'
    },
    {
        id: 'demo-b35',
        kind: 'order',
        title: 'Poz 9.1 - Untrašnja obloga oko ulaznih vrata · Hotel Jezero',
        startISO: '2026-12-08',
        endISO: '2026-12-08',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w15',
                name: 'Mirza Kolar'
            },
            {
                id: 'demo-w06',
                name: 'Sanel Avdić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c35-1',
                lead: {
                    id: 'demo-w15',
                    name: 'Mirza Kolar'
                },
                members: [
                    {
                        id: 'demo-w06',
                        name: 'Sanel Avdić'
                    }
                ]
            },
            {
                id: 'demo-c35-2',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c35-1'
    },
    {
        id: 'demo-b36',
        kind: 'order',
        title: 'Poz 9 -Ulazna vrata · Hotel Jezero',
        startISO: '2026-12-02',
        endISO: '2026-12-03',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w15',
                name: 'Mirza Kolar'
            },
            {
                id: 'demo-w06',
                name: 'Sanel Avdić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c36-1',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            },
            {
                id: 'demo-c36-2',
                lead: {
                    id: 'demo-w15',
                    name: 'Mirza Kolar'
                },
                members: [
                    {
                        id: 'demo-w06',
                        name: 'Sanel Avdić'
                    }
                ]
            },
            {
                id: 'demo-c36-3',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c36-2'
    },
    {
        id: 'demo-b37',
        kind: 'order',
        title: 'Poz 6 -Radni sto · Hotel Jezero',
        startISO: '2026-12-07',
        endISO: '2026-12-07',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c37-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c37-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c37-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            },
            {
                id: 'demo-c37-4',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c37-1'
    },
    {
        id: 'demo-b38',
        kind: 'order',
        title: 'Poz 8.1 -Uzglavlje · Hotel Jezero',
        startISO: '2026-12-08',
        endISO: '2026-12-08',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c38-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c38-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c38-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            },
            {
                id: 'demo-c38-4',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c38-1'
    },
    {
        id: 'demo-b39',
        kind: 'order',
        title: 'Poz 10 -WC vrata · Hotel Jezero',
        startISO: '2026-12-04',
        endISO: '2026-12-07',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w15',
                name: 'Mirza Kolar'
            },
            {
                id: 'demo-w06',
                name: 'Sanel Avdić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c39-1',
                lead: {
                    id: 'demo-w15',
                    name: 'Mirza Kolar'
                },
                members: [
                    {
                        id: 'demo-w06',
                        name: 'Sanel Avdić'
                    }
                ]
            },
            {
                id: 'demo-c39-2',
                lead: {
                    id: 'demo-w16',
                    name: 'Mirsad Omerović'
                },
                members: [
                    {
                        id: 'demo-w03',
                        name: 'Avdo Hasić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c39-1'
    },
    {
        id: 'demo-b40',
        kind: 'order',
        title: 'Poz 5 -Obloga TV-a sa ogledalima · Hotel Jezero',
        startISO: '2026-11-30',
        endISO: '2026-12-01',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w01',
                name: 'Ismet Dedić'
            },
            {
                id: 'demo-w13',
                name: 'Adnan Pašić'
            }
        ],
        workerDays: 4,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c40-1',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c40-2',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            },
            {
                id: 'demo-c40-3',
                lead: {
                    id: 'demo-w01',
                    name: 'Ismet Dedić'
                },
                members: [
                    {
                        id: 'demo-w13',
                        name: 'Adnan Pašić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c40-3'
    },
    {
        id: 'demo-b41',
        kind: 'order',
        title: 'Poz 7 - Noćni ormarići · Hotel Jezero',
        startISO: '2026-12-09',
        endISO: '2026-12-09',
        projectRef: {
            id: 'demo-p-jezero',
            name: 'Hotel Jezero'
        },
        workerRefs: [
            {
                id: 'demo-w07',
                name: 'Nedžad Kovač'
            },
            {
                id: 'demo-w02',
                name: 'Almir Hadžić'
            }
        ],
        workerDays: 2,
        crew: 2,
        priority: 'high',
        crewOptions: [
            {
                id: 'demo-c41-1',
                lead: {
                    id: 'demo-w07',
                    name: 'Nedžad Kovač'
                },
                members: [
                    {
                        id: 'demo-w02',
                        name: 'Almir Hadžić'
                    }
                ]
            },
            {
                id: 'demo-c41-2',
                lead: {
                    id: 'demo-w09',
                    name: 'Neven Ibrić'
                },
                members: [
                    {
                        id: 'demo-w17',
                        name: 'Esad Turković'
                    }
                ]
            },
            {
                id: 'demo-c41-3',
                lead: {
                    id: 'demo-w08',
                    name: 'Brane Karić'
                },
                members: [
                    {
                        id: 'demo-w12',
                        name: 'Begzudin Sejdić'
                    }
                ]
            }
        ],
        assignedCrewId: 'demo-c41-1'
    }
];

/** Dva bloka su „pretvorena" u stvarne naloge — da se vidi izgled živog statusa. */
blocks[18].linkedWorkOrderId = 'demo-wo-1';
blocks[29].linkedWorkOrderId = 'demo-wo-2';

export const demoCanvasWorkOrders: WorkOrder[] = [
    { Work_Order_ID: 'demo-wo-1', Work_Order_Number: 'RN-118', Status: 'U toku', items: [] } as unknown as WorkOrder,
    { Work_Order_ID: 'demo-wo-2', Work_Order_Number: 'RN-121', Status: 'Na čekanju', items: [] } as unknown as WorkOrder,
];

/** Slobodan radnik na odmoru — sjena odsustva u prikazu Ekipe. */
export const demoCanvasAttendance: WorkerAttendance[] = ['2026-12-07', '2026-12-08', '2026-12-09'].map(d => ({
    Attendance_ID: `demo-att-${d}`, Organization_ID: 'demo', Worker_ID: 'demo-w04',
    Worker_Name: 'Elvir Zukić', Date: d, Status: 'Odmor',
} as WorkerAttendance));

export function demoCanvasScenario(view: Partial<NonNullable<PlanScenario['View']>> = {}): PlanScenario {
    return {
        Scenario_ID: 'demo-plan',
        Organization_ID: '',
        Name: 'Jezero, Marić, Atrij, Planina',
        Created_Date: '2026-11-20T08:00:00.000Z',
        Modified_Date: '2026-11-21T08:12:00.000Z',
        Version: 1,
        Blocks: blocks.map(b => ({ ...b })),
        Links: [],
        View: { zoom: 'sedmica', anchorISO: '2026-11-29', groupBy: 'project', layout: 'unified-project', ...view },
    };
}
