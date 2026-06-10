// Global error handler for debugging
window.addEventListener('error', (event) => {
    console.error('Global script error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack
    });
});

// Check for Firebase availability
console.log('Checking Firebase dependencies...');
const firebaseAvailable = typeof window.firebase !== 'undefined';
const dbAvailable = typeof window.db !== 'undefined';
const dbInstance = dbAvailable ? window.db : null;
const db = dbAvailable ? window.db : null;
if (!firebaseAvailable) {
    console.error('Firebase SDK not loaded - check CDN connection');
}
if (!dbAvailable) {
    console.warn('Firestore db is not available. The app will run in local-only mode.');
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Script iniciando...', {
        docReady: document.readyState,
        location: window.location.href,
        hasFirebase: firebaseAvailable,
        hasDb: dbAvailable
    });
    // Global Master Reset (One-time for all users)
    if (!localStorage.getItem('moura_leite_master_reset_v2')) {
        let allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        
        // Ensure Admin exists in the global list
        if (!allUsers.find(u => u.email === 'admin@mouraleite.com.br')) {
            allUsers.push({
                username: 'ADMIN',
                email: 'admin@mouraleite.com.br',
                points: 1500,
                dept: 'Tecnologia',
                rank: 'Consultor Ouro',
                password: 'admin'
            });
        }

        allUsers.forEach(user => {
            if (user.email !== 'admin@mouraleite.com.br') {
                user.points = 0;
                user.history = [];
                user.lastCheckIn = null;
                user.lastLunchWeek = null;
                user.lastReuniaoWeek = null;
                user.lastGamesWeek = null;
                user.lastLinkedInMonth = null;
                user.lastVivaEngageMonth = null;
                user.lunchCount = 0;
                user.linkedInCount = 0;
                user.vivaEngageCount = 0;
                user.streak = 1;
                user.visitCount = 1;
            }
        });
        localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
        localStorage.setItem('moura_leite_global_history', JSON.stringify([]));
        
        // Update current session if not admin
        let sessionUser = JSON.parse(localStorage.getItem('moura_leite_user'));
        if (sessionUser && sessionUser.email !== 'admin@mouraleite.com.br') {
            sessionUser.points = 0;
            sessionUser.history = [];
            sessionUser.lastCheckIn = null;
            sessionUser.lastLunchWeek = null;
            sessionUser.lastReuniaoWeek = null;
            sessionUser.lastGamesWeek = null;
            sessionUser.lastLinkedInMonth = null;
            sessionUser.lastVivaEngageMonth = null;
            sessionUser.lunchCount = 0;
            sessionUser.linkedInCount = 0;
            sessionUser.vivaEngageCount = 0;
            localStorage.setItem('moura_leite_user', JSON.stringify(sessionUser));
        }
        
        localStorage.setItem('moura_leite_master_reset_v2', 'true');
        window.location.reload();
    }

    // Server Time Validation (Anti-cheat: prevent Windows date manipulation)
    let serverTimeOffset = 0;
    let serverTimeLastSync = Date.now();

    const syncServerTime = async () => {
        // Obsolete: Relying on Date.now()
        serverTimeOffset = 0;
        serverTimeLastSync = Date.now();
    };

    const getServerTime = () => {
        return Date.now();
    };

    const logMissionAttempt = async (userId, missionId, missionName, success, timestamp) => {
        if (!dbAvailable) {
            console.warn('Skipping mission log because Firestore is unavailable.');
            return;
        }

        try {
            const logsRef = db.collection('mission_logs').doc();
            await logsRef.set({
                userId,
                missionId,
                missionName,
                success,
                clientTime: new Date(timestamp),
                serverTime: firebase.firestore.FieldValue.serverTimestamp(),
                userAgent: navigator.userAgent
            });
        } catch (e) {
            console.error('Error logging mission attempt:', e);
        }
    };

    // Initial sync on page load
    syncServerTime();

    // Resync every 10 minutes
    setInterval(syncServerTime, 600000);

    // Load User Data from LocalStorage (Current Session)
    const storedUser = JSON.parse(localStorage.getItem('moura_leite_user')) || {
        username: 'Novo Colaborador',
        points: 0,
        rank: 'Iniciante',
        dept: 'Moura Leite'
    };

    // Firebase Real-time Synchronization for Global Users
    if (dbAvailable) {
        db.collection("users").onSnapshot((snapshot) => {
            const usersArray = [];
            snapshot.forEach((doc) => {
                usersArray.push(doc.data());
            });
            
            // Strip large base64 photos to prevent localStorage quota issues from legacy data
            const cleanUsersArray = usersArray.map(u => {
                const cleanU = { ...u };
                if (cleanU.history && Array.isArray(cleanU.history)) {
                    cleanU.history = cleanU.history.map(tx => {
                        if (tx.photo && typeof tx.photo === 'string' && tx.photo.length > 500) {
                            return { ...tx, photo: '[EVIDENCIA_SALVA]', hasPhoto: true };
                        }
                        return tx;
                    });
                }
                return cleanU;
            });

            // Update local global list
            try {
                localStorage.setItem('moura_leite_all_users', JSON.stringify(cleanUsersArray));
            } catch (storageErr) {
                console.warn('Não foi possível salvar all_users no localStorage (limite excedido?).', storageErr);
            }

            // FIREBASE É A FONTE DA VERDADE: Sempre sincroniza dados do servidor para o local
            if (storedUser && storedUser.email) {
                const currentUserInDb = usersArray.find(u => u.email === storedUser.email);
                if (currentUserInDb) {
                    let needsUpdate = false;
                    
                    // Sync points
                    const serverPoints = parseInt(currentUserInDb.points) || 0;
                    if (serverPoints !== userPoints) {
                        console.log(`🔄 Sincronizando pontos do servidor: Local(${userPoints}) → Server(${serverPoints})`);
                        userPoints = serverPoints;
                        needsUpdate = true;
                    }
                    
                    // CRITICAL FIX: Sync all completion flags and history so local state matches server
                    Object.keys(currentUserInDb).forEach(key => {
                        if (key.startsWith('last') || key === 'history' || key.endsWith('Count')) {
                            // Only update if stringified values differ to avoid deep comparison complexity
                            if (JSON.stringify(storedUser[key]) !== JSON.stringify(currentUserInDb[key])) {
                                storedUser[key] = currentUserInDb[key];
                                needsUpdate = true;
                            }
                        }
                    });

                    // RESET FIX: If a 'last*' cooldown field was deleted from Firestore
                    // (e.g., by adminResetMission), remove it from localStorage too.
                    // Without this, the mission keeps showing as "Concluído" even after admin reset.
                    Object.keys(storedUser).forEach(key => {
                        if ((key.startsWith('last') || key.startsWith('lastCustom')) && !(key in currentUserInDb)) {
                            delete storedUser[key];
                            needsUpdate = true;
                        }
                    });

                    if (needsUpdate) {
                        storedUser.points = userPoints;
                        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                        if (typeof updatePointsDisplay === 'function') updatePointsDisplay();
                        if (typeof renderCustomMissions === 'function') renderCustomMissions();
                    }
                }
            }
            
            // Re-render UI components that depend on global data
            if (typeof updateRanking === 'function') updateRanking();
            if (typeof renderAdminUsers === 'function') renderAdminUsers();
        });
    } else {
        console.warn('Skipping Firestore user sync because db is unavailable.');
    }

    // Visit Tracking & Date Helpers (Now using server-synced time)
    const now = new Date(getServerTime());
    const todayStr = now.toDateString();
    const currentMonth = (now.getMonth() + 1) + '-' + now.getFullYear();
    
    const getWeekNumber = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
        return Math.ceil((((d - yearStart) / 86400000) + 1)/7) + '-' + d.getUTCFullYear();
    };
    const currentWeek = getWeekNumber(now);

    // Migration/Reset Fix: Force Alex to 0 if he has legacy points (One-time)
    if (storedUser.email === 'alex.landuci@mouraleite.com.br' && !storedUser.legacyReset) {
        storedUser.username = 'Alexsanderson Landuci'; // Force correct name
        storedUser.dept = 'RH';
        storedUser.diretoria = 'Financeira';
        if (storedUser.points === 2450 || storedUser.points === 800) {
            storedUser.points = 0;
            // Sync with global list
            const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
            const idx = allUsers.findIndex(u => u.email === storedUser.email);
            if (idx !== -1) {
                allUsers[idx].username = 'Alexsanderson Landuci';
                allUsers[idx].points = 0;
                localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
            }
        }
        storedUser.legacyReset = true;
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
    }

    // Force Admin name
    if (storedUser.email === 'admin@mouraleite.com.br') {
        storedUser.username = 'ADMIN';
    }

    const isAdmin = storedUser.email === 'admin@mouraleite.com.br';
    const adminMenuItem = document.getElementById('admin-menu-item');
    const adminMissionsMenuItem = document.getElementById('admin-missions-menu-item');
    const adminPrizesMenuItem = document.getElementById('admin-prizes-menu-item');
    if (isAdmin && adminMenuItem) {
        adminMenuItem.classList.remove('hidden');
    }
    if (isAdmin && adminMissionsMenuItem) {
        adminMissionsMenuItem.classList.remove('hidden');
    }
    if (isAdmin && adminPrizesMenuItem) {
        adminPrizesMenuItem.classList.remove('hidden');
    }

    // Admin User Management Logic
    const renderAdminUsers = () => {
        const body = document.getElementById('admin-users-body');
        if (!body) return;

        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        
        body.innerHTML = allUsers.map(user => {
            const statusLabel = user.disabled ? 'Inativo' : 'Ativo';
            const statusClass = user.disabled ? 'status-locked' : 'status-unlocked';
            
            return `
                <tr>
                    <td><strong>${user.username}</strong></td>
                    <td>${user.email}</td>
                    <td>${user.dept || '-'}</td>
                    <td>${user.diretoria ? (user.diretoria.replace(/^diretoria-/i, '').charAt(0).toUpperCase() + user.diretoria.replace(/^diretoria-/i, '').slice(1)) : '-'}</td>
                    <td>${user.points} ML Coins</td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button onclick="viewUserHistory('${user.email}', '${user.username}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#006837;">📋 Histórico</button>
                            <button onclick="editUser('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px;">Editar</button>
                            <button onclick="resetUserPassword('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#f39c12;">Resetar Senha</button>
                            <button onclick="toggleUserStatus('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#666;">${user.disabled ? 'Ativar' : 'Desativar'}</button>
                            ${user.email !== 'admin@mouraleite.com.br' ? `
                            <button onclick="(function(){ var m=prompt('ID da missão para resetar o cooldown:\\n\\nsys_lunch = Café de Integração\\nsys_reuniao = Reunião de Integração\\nsys_jogos = Dinâmica de Jogos\\nsys_checkin = Check-in Diário\\nsys_embaixador = Embaixador Digital\\nsys_vivaengage = Viva Engage\\n\\n(ou o ID de uma missão personalizada)'); if(m && m.trim()) adminResetMission('${user.email}', m.trim()); })()" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#1976d2;">Resetar Missão</button>
                            <button onclick="deleteUser('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#d32f2f;">Excluir</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    window.viewUserHistory = async (email, username) => {
        const modal = document.getElementById('user-history-modal');
        const body = document.getElementById('user-history-modal-body');
        const title = document.getElementById('user-history-modal-title');
        const subtitle = document.getElementById('user-history-modal-subtitle');
        const summary = document.getElementById('user-history-summary');

        if (!modal) return;

        title.textContent = `📋 Histórico de Pontos — ${username}`;
        subtitle.textContent = email;
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#999;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando dados do Firebase...</td></tr>';
        summary.innerHTML = '';
        modal.classList.remove('hidden');

        try {
            const doc = await db.collection('users').doc(email).get({ source: 'server' });
            if (!doc.exists) {
                body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#f44336;">Usuário não encontrado no Firebase.</td></tr>';
                return;
            }

            const userData = doc.data();
            const history = userData.history || [];

            // Sort newest first
            const sorted = [...history].sort((a, b) => (b.serverTime || 0) - (a.serverTime || 0));

            // Calculate totals
            let totalEarned = 0;
            let totalSpent = 0;

            sorted.forEach(tx => {
                const earnedMatch = (tx.item || '').match(/\(\+(\d+)\s*(?:pts|ML Coins|Moura Coins)\)/);
                const spentMatch  = (tx.item || '').match(/\(\-(\d+)\s*(?:pts|ML Coins|Moura Coins)\)/);
                if (tx.status === 'Recusado' || tx.status === 'Cancelado') return;
                if (earnedMatch) totalEarned += parseInt(earnedMatch[1]);
                else if (spentMatch) totalSpent += parseInt(spentMatch[1]);
            });

            // Summary pills
            summary.innerHTML = `
                <div style="background:#e8f5e9;color:#1b5e20;padding:8px 16px;border-radius:20px;font-size:0.85rem;font-weight:600;">
                    ✅ Ganhou: +${totalEarned} ML Coins
                </div>
                <div style="background:#fce4ec;color:#880e4f;padding:8px 16px;border-radius:20px;font-size:0.85rem;font-weight:600;">
                    🛒 Gastou: -${totalSpent} ML Coins
                </div>
                <div style="background:#e3f2fd;color:#0d47a1;padding:8px 16px;border-radius:20px;font-size:0.85rem;font-weight:600;">
                    💰 Saldo Calculado: ${totalEarned - totalSpent} ML Coins
                </div>
                <div style="background:#f3e5f5;color:#4a148c;padding:8px 16px;border-radius:20px;font-size:0.85rem;font-weight:600;">
                    📊 Total de Registros: ${sorted.length}
                </div>
            `;

            if (sorted.length === 0) {
                body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#999;">Nenhum registro encontrado.</td></tr>';
                return;
            }

            body.innerHTML = sorted.map(tx => {
                const earnedMatch = (tx.item || '').match(/\(\+(\d+)\s*(?:pts|ML Coins|Moura Coins)\)/);
                const spentMatch  = (tx.item || '').match(/\(\-(\d+)\s*(?:pts|ML Coins|Moura Coins)\)/);
                const isRejected  = tx.status === 'Recusado' || tx.status === 'Cancelado';

                let ptsDisplay = '-';
                let ptsCls = '';
                if (isRejected) {
                    ptsDisplay = `<span style="color:#f44336;text-decoration:line-through;">Recusado</span>`;
                } else if (earnedMatch) {
                    ptsDisplay = `<span style="color:#4caf50;font-weight:700;">+${earnedMatch[1]} ML Coins</span>`;
                    ptsCls = 'earned';
                } else if (spentMatch) {
                    ptsDisplay = `<span style="color:#e53935;font-weight:700;">-${spentMatch[1]} ML Coins</span>`;
                    ptsCls = 'spent';
                }

                const statusColors = {
                    'Concluído': '#4caf50', 'Validando': '#ff9800',
                    'Recusado': '#f44336', 'Cancelado': '#9e9e9e', 'Ativo': '#2196f3'
                };
                const sColor = statusColors[tx.status] || '#999';

                return `<tr>
                    <td>${tx.date || '—'}</td>
                    <td>${tx.time || '—'}</td>
                    <td>${(tx.item || '—').replace(/pts|Moura Coins/gi, 'ML Coins')}</td>
                    <td style="text-align:center;">${ptsDisplay}</td>
                    <td><span class="status-badge" style="background:${sColor}20;color:${sColor};border:1px solid ${sColor}40;">${tx.status || '—'}</span></td>
                </tr>`;
            }).join('');

        } catch (err) {
            console.error('Erro ao carregar histórico do usuário:', err);
            body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:#f44336;">Erro ao carregar dados: ${err.message}</td></tr>`;
        }
    };

    // Close user history modal
    const closeUserHistoryBtn = document.getElementById('close-user-history');
    const userHistoryModal = document.getElementById('user-history-modal');
    if (closeUserHistoryBtn) {
        closeUserHistoryBtn.addEventListener('click', () => userHistoryModal.classList.add('hidden'));
    }
    if (userHistoryModal) {
        userHistoryModal.addEventListener('click', (e) => {
            if (e.target === userHistoryModal) userHistoryModal.classList.add('hidden');
        });
    }

    const getIconClass = (iconName) => {
        if (!iconName) return 'fa-solid fa-bullseye';
        if (iconName === 'svg-cap') return 'svg-cap'; // special SVG icon
        if (iconName === 'svg-capsule') return 'svg-capsule'; // special SVG icon
        if (iconName.startsWith('fa-')) {
            // Check if it already has a style prefix (solid, brands, regular)
            if (iconName.startsWith('fa-solid ') || iconName.startsWith('fa-brands ') || iconName.startsWith('fa-regular ') || iconName.startsWith('fa-light ') || iconName.startsWith('fa-thin ')) {
                return iconName;
            }
            // Check for brand icons that need fa-brands
            const brands = ['linkedin', 'facebook', 'instagram', 'twitter', 'whatsapp', 'github', 'youtube', 'viva-engage', 'microsoft', 'google', 'apple'];
            if (brands.some(brand => iconName.includes(brand))) {
                return `fa-brands ${iconName}`;
            }
            // Default to fa-solid
            return `fa-solid ${iconName}`;
        }
        return iconName;
    };

    // Returns full HTML for an icon (supports custom SVGs)
    const getIconHTML = (iconName, color) => {
        if (iconName === 'svg-cap') {
            const c = color || '#006837';
            return `<svg viewBox="0 0 100 100" width="1em" height="1em" style="font-size:inherit;">
                <path d="M50 18 C30 18 16 32 14 50 L14 58 C14 60 15 62 17 62 L83 62 C85 62 86 60 86 58 L86 50 C84 32 70 18 50 18 Z" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>
                <path d="M14 56 C14 56 8 58 4 62 C2 64 1 67 3 69 C5 71 10 72 14 70 C18 68 28 64 38 62 L14 62 Z" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>
                <line x1="14" y1="56" x2="86" y2="56" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
                <circle cx="50" cy="18" r="3" fill="${c}" stroke="${c}" stroke-width="1"/>
            </svg>`;
        }
        if (iconName === 'svg-capsule' || iconName === 'svg-capsule-5' || iconName === 'svg-capsule-10' || iconName === 'svg-capsule-box') {
            const makeCap = (x, y, scale, color) => `
                <g transform="translate(${x}, ${y}) scale(${scale})">
                    <path d="M -12 -4 L -9 15 C -8 24, 8 24, 9 15 L 12 -4 Z" fill="${color}" />
                    <rect x="-15" y="-10" width="30" height="6" rx="2" fill="#8A6046" />
                    <line x1="-10.5" y1="12" x2="10.5" y2="12" />
                    <line x1="-6" y1="0" x2="-4" y2="10" stroke="#FFFFFF" stroke-width="2" opacity="0.5" />
                    <line x1="-10" y1="-7" x2="-2" y2="-7" stroke="#FFFFFF" stroke-width="2" opacity="0.5" />
                </g>`;
            const beanBadge = (y) => `
                <g transform="translate(50, ${y}) scale(1.2)">
                    <circle cx="0" cy="0" r="16" fill="#FFFFFF" />
                    <g transform="rotate(-30)">
                        <ellipse cx="0" cy="0" rx="7" ry="10" fill="#8A6046" />
                        <path d="M -2 -6 C 2 -4, 2 0, 0 2 C -2 4, -2 8, 2 10" fill="none" stroke="#1A1A1A" stroke-width="2.5" />
                    </g>
                </g>`;

            let contents = '';
            let strokeW = 3.5;

            if (iconName === 'svg-capsule') {
                contents = makeCap(25, 40, 1.1, '#8CB4F5') +
                           makeCap(75, 40, 1.1, '#C2E88D') +
                           makeCap(50, 36, 1.25, '#E36262') +
                           beanBadge(72);
            } else if (iconName === 'svg-capsule-5') {
                contents = makeCap(20, 36, 0.9, '#F2A65A') +
                           makeCap(80, 36, 0.9, '#B39DDB') +
                           makeCap(35, 41, 1.0, '#8CB4F5') +
                           makeCap(65, 41, 1.0, '#C2E88D') +
                           makeCap(50, 46, 1.15, '#E36262') +
                           beanBadge(76);
            } else if (iconName === 'svg-capsule-10') {
                strokeW = 3.0; // Slightly thinner stroke for crowded pile
                contents = makeCap(25, 25, 0.7, '#4DD0E1') +
                           makeCap(42, 25, 0.7, '#FFF176') +
                           makeCap(58, 25, 0.7, '#F06292') +
                           makeCap(75, 25, 0.7, '#AED581') +
                           makeCap(30, 35, 0.85, '#FFB74D') +
                           makeCap(50, 35, 0.85, '#90A4AE') +
                           makeCap(70, 35, 0.85, '#4DB6AC') +
                           makeCap(38, 48, 1.0, '#8CB4F5') +
                           makeCap(62, 48, 1.0, '#C2E88D') +
                           makeCap(50, 60, 1.15, '#E36262') +
                           beanBadge(85);
            } else if (iconName === 'svg-capsule-box') {
                const cColor = color || '#006837';
                contents = `
                    <!-- Right Face (Darker) -->
                    <polygon points="65,45 85,35 85,65 65,75" fill="${cColor}" />
                    <polygon points="65,45 85,35 85,65 65,75" fill="#000000" opacity="0.25" stroke="none" />

                    <!-- Top Face -->
                    <polygon points="45,35 65,25 85,35 65,45" fill="${cColor}" />
                    <polygon points="45,35 65,25 85,35 65,45" fill="#FFFFFF" opacity="0.3" stroke="none" />

                    <!-- Left Face (Front) -->
                    <polygon points="45,35 65,45 65,75 45,65" fill="${cColor}" />
                    <polygon points="45,35 65,45 65,75 45,65" fill="#000000" opacity="0.05" stroke="none" />
                    
                    <!-- Left Face Decorations (Logo) -->
                    <g stroke="none">
                        <g transform="translate(55, 60) scale(0.6)">
                            <path d="M -12 -4 L -9 15 C -8 24, 8 24, 9 15 L 12 -4 Z" fill="#FFFFFF" opacity="0.7" />
                            <rect x="-15" y="-10" width="30" height="6" rx="2" fill="#FFFFFF" opacity="0.7" />
                        </g>
                    </g>

                    <!-- Loose capsules sitting in front of the box -->
                    ${makeCap(32, 75, 0.9, '#F06292')}
                    ${makeCap(48, 85, 1.1, '#FFB74D')}
                `;
            }

            return `<svg viewBox="0 0 100 100" width="1em" height="1em" style="font-size:inherit;">
                <g stroke="#1A1A1A" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">
                    ${contents}
                </g>
            </svg>`;
        }
        if (iconName === 'svg-capsule-flat') {
            const c = color || '#006837';
            return `<svg viewBox="0 0 100 100" width="1em" height="1em" style="font-size:inherit;">
                <path d="M 12 18 L 88 18 A 6 6 0 0 1 94 24 L 94 28 A 6 6 0 0 1 88 34 L 12 34 A 6 6 0 0 1 6 28 L 6 24 A 6 6 0 0 1 12 18 Z" fill="${c}" />
                <path d="M 22 38 L 32 85 C 33 93, 40 98, 50 98 C 60 98, 67 93, 68 85 L 78 38 Z
                         M 50 47 C 59 47, 62 55, 62 65 C 62 75, 59 83, 50 83 C 41 83, 38 75, 38 65 C 38 55, 41 47, 50 47 Z" fill="${c}" fill-rule="evenodd" />
                <path d="M 48 52 C 54 52, 54 60, 50 65 C 46 70, 46 78, 52 78" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" />
            </svg>`;
        }
        if (iconName === 'svg-capsule-3d') {
            const c = color || '#006837';
            return `<svg viewBox="0 0 100 100" width="1em" height="1em" style="font-size:inherit; filter: drop-shadow(0px 8px 10px rgba(0,0,0,0.25));">
                <defs>
                    <linearGradient id="coffeeShine_${c.replace('#','')}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#000000" stop-opacity="0.5" />
                        <stop offset="20%" stop-color="#ffffff" stop-opacity="0.9" />
                        <stop offset="40%" stop-color="#ffffff" stop-opacity="0.1" />
                        <stop offset="75%" stop-color="#000000" stop-opacity="0.7" />
                        <stop offset="90%" stop-color="#ffffff" stop-opacity="0.4" />
                        <stop offset="100%" stop-color="#000000" stop-opacity="0.6" />
                    </linearGradient>
                    <linearGradient id="foilLid_${c.replace('#','')}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#f0f0f0" />
                        <stop offset="50%" stop-color="#ffffff" />
                        <stop offset="100%" stop-color="#a0a0a0" />
                    </linearGradient>
                </defs>
                <g transform="rotate(-15 50 50) translate(0, 5)">
                    <path d="M22 25 L32 78 C 32 92, 68 92, 68 78 L78 25 Z" fill="${c}" />
                    <path d="M22 25 L32 78 C 32 92, 68 92, 68 78 L78 25 Z" fill="url(#coffeeShine_${c.replace('#','')})" />
                    <ellipse cx="50" cy="25" rx="38" ry="10" fill="${c}" />
                    <ellipse cx="50" cy="25" rx="38" ry="10" fill="url(#coffeeShine_${c.replace('#','')})" />
                    <ellipse cx="50" cy="25" rx="34" ry="8" fill="url(#foilLid_${c.replace('#','')})" />
                    <ellipse cx="50" cy="25" rx="26" ry="6" fill="none" stroke="#cccccc" stroke-width="1.5" />
                    <ellipse cx="50" cy="25" rx="18" ry="4" fill="none" stroke="#ffffff" stroke-width="2" />
                    <ellipse cx="50" cy="25" rx="10" ry="2" fill="none" stroke="#aaaaaa" stroke-width="1" />
                </g>
            </svg>`;
        }
        if (iconName === 'svg-capsule-outline') {
            const c = color || '#006837';
            return `<svg viewBox="0 0 100 100" width="1em" height="1em" style="font-size:inherit;">
                <path d="M 12 18 L 88 18 A 6 6 0 0 1 94 24 L 94 28 A 6 6 0 0 1 88 34 L 12 34 A 6 6 0 0 1 6 28 L 6 24 A 6 6 0 0 1 12 18 Z" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round" />
                <path d="M 22 34 L 32 85 C 33 93, 40 98, 50 98 C 60 98, 67 93, 68 85 L 78 34" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
                <ellipse cx="50" cy="62" rx="12" ry="18" fill="none" stroke="${c}" stroke-width="5" />
                <path d="M 48 50 C 55 50, 55 60, 50 62 C 45 64, 45 74, 52 74" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" />
            </svg>`;
        }
        const cls = getIconClass(iconName || 'fa-gift');
        return `<i class="${cls}" style="color: ${color || '#006837'};"></i>`;
    };

    // Admin Mission Creation Logic
    const renderAdminMissions = () => {
        const iconSelect = document.getElementById('mission-icon');
        const iconPreview = document.getElementById('mission-icon-preview');

        if (iconSelect && iconPreview) {
            const updateIconPreview = () => {
                const iconValue = iconSelect.value || 'fa-question';
                iconPreview.innerHTML = `<i class="${getIconClass(iconValue)}"></i>`;
            };
            iconSelect.addEventListener('change', updateIconPreview);
            updateIconPreview();
        }
    };

    const missionsCollection = dbAvailable && dbInstance ? dbInstance.collection('custom_missions') : null;
    let sharedMissionCache = [];

    const getMissionData = () => {
        const localMissions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        if (dbAvailable) {
            return sharedMissionCache.length ? sharedMissionCache : localMissions;
        }
        return localMissions;
    };

    const subscribeSharedMissions = () => {
        if (!dbAvailable || !missionsCollection) {
            console.warn('Skipping shared missions subscription because Firestore is unavailable.');
            return;
        }

        missionsCollection.orderBy('createdAt', 'asc').onSnapshot((snapshot) => {
            sharedMissionCache = [];
            snapshot.forEach((doc) => {
                sharedMissionCache.push(doc.data());
            });
            localStorage.setItem('moura_leite_missions', JSON.stringify(sharedMissionCache));
            renderCustomMissions();
            if (typeof renderAdminMissionsList === 'function') renderAdminMissionsList();
            console.log('Shared missions synced from Firestore:', sharedMissionCache.length);
        }, (error) => {
            console.error('Error syncing shared missions:', error);
        });
    };

    // Register mission form listener once
    const registerMissionFormListener = () => {
        const missionForm = document.getElementById('mission-form');
        if (missionForm && !missionForm.hasListener) {
            console.log('Mission form found, registering submit listener');
            missionForm.addEventListener('submit', handleMissionSubmit);
            
            // Icon & Color Real-time Preview Logic
            const iconSelect = document.getElementById('mission-icon');
            const colorInput = document.getElementById('mission-color');
            const previewBox = document.getElementById('mission-icon-preview');
            
            const updatePreview = () => {
                if (!previewBox) return;
                const iconValue = iconSelect.value || 'fa-question';
                const color = colorInput.value || '#1976d2';
                previewBox.innerHTML = `<i class="${getIconClass(iconValue)}" style="color: ${color};"></i>`;
            };
            
            if (iconSelect) iconSelect.addEventListener('change', updatePreview);
            if (colorInput) colorInput.addEventListener('input', updatePreview);
            
            const cancelBtn = document.getElementById('cancel-edit-mission-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    missionForm.reset();
                    delete missionForm.dataset.editingId;
                    const submitBtn = missionForm.querySelector('button[type="submit"]');
                    if (submitBtn) submitBtn.textContent = 'Cadastrar Missão';
                    cancelBtn.classList.add('hidden');
                    updatePreview();
                });
            }

            missionForm.hasListener = true;
        } else if (missionForm) {
            console.log('Mission form listener already registered');
        } else {
            console.warn('Mission form not found');
        }
    };
    
    const seedDefaultMissions = () => {
        const SEED_VERSION = 'moura_leite_seeded_v2';
        if (!localStorage.getItem(SEED_VERSION)) {
            const defaults = [
                { id: 'sys_checkin', name: 'Check-in Diário', frequency: 'daily', points: 1, validationType: 'button', active: true, surprise: false, description: 'Garanta seu ponto diário apenas acessando o portal.', icon: 'fa-calendar-check', color: '#1976d2', createdAt: new Date().toISOString() },
                { id: 'sys_lunch', name: 'Integração entre Times', frequency: 'weekly', points: 5, validationType: 'photo', active: true, surprise: false, description: 'Almoço com você + 2 pessoas de departamentos diferentes.', icon: 'fa-people-arrows', color: '#f57c00', createdAt: new Date().toISOString() },
                { id: 'sys_reuniao', name: 'Reunião de Integração', frequency: 'weekly', points: 8, validationType: 'photo', active: true, surprise: false, description: 'Participe de um encontro com colegas de outro setor.', icon: 'fa-handshake', color: '#4caf50', createdAt: new Date().toISOString() },
                { id: 'sys_embaixador', name: 'Embaixador Digital', frequency: 'monthly', points: 15, validationType: 'link', active: true, surprise: false, description: 'Compartilhe o novo lançamento da Moura Leite no seu LinkedIn pessoal.', icon: 'fa-brands fa-linkedin', color: '#0077b5', createdAt: new Date().toISOString() },
                { id: 'sys_vivaengage', name: 'Engajamento Viva Engage', frequency: 'monthly', points: 12, validationType: 'link', active: true, surprise: false, description: 'Faça uma postagem no Viva Engage da empresa.', icon: 'fa-share-nodes', color: '#7b2cbf', createdAt: new Date().toISOString() },
                { id: 'sys_jogos', name: 'Dinâmica de Jogos', frequency: 'weekly', points: 20, validationType: 'photo', active: true, surprise: false, description: 'Participe da dinâmica de interação dos nossos jogos de tabuleiro durante a semana. Procure o Alex ou a Mariana do RH para alinhar o dia e horário.', icon: 'fa-people-group', color: '#F1863B', createdAt: new Date().toISOString() }
            ];
            
            let missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
            defaults.forEach(d => {
                const idx = missions.findIndex(m => m.id === d.id);
                if (idx === -1) {
                    missions.push(d);
                } else {
                    // Update system missions properties
                    missions[idx] = { ...missions[idx], ...d };
                }
            });
            localStorage.setItem('moura_leite_missions', JSON.stringify(missions));
            localStorage.setItem(SEED_VERSION, 'true');
            
            if (dbAvailable && missionsCollection) {
                defaults.forEach(async d => {
                    try {
                        const docRef = missionsCollection.doc(d.id);
                        const docSnap = await docRef.get();
                        if (!docSnap.exists) {
                            await docRef.set(d, {merge: true});
                        }
                    } catch (e) {
                        console.error('Error seeding mission:', e);
                    }
                });
            }
        }
    };

    
    const renderCustomMissions = () => {
        const questsGrid = document.getElementById('quests-grid');
        if (!questsGrid) return;

        // Remove previously injected custom missions to avoid duplicates
        questsGrid.querySelectorAll('.custom-quest-card').forEach(card => card.remove());

        const missions = getMissionData();
        if (missions.length === 0) {
            return;
        }

        const multiplier = getCurrentMultiplier();
        questsGrid.insertAdjacentHTML('beforeend', missions
            .filter(m => m.active)
            .map(mission => {
                const badgeLabel = mission.frequency === 'daily' ? 'Diário' : mission.frequency === 'weekly' ? 'Semanal' : 'Mensal';
                const showFrequencyBadge = !mission.surprise;
                const surpriseBadge = mission.surprise ? `<div class="quest-surprise-badge"><span class="fire-emoji">🔥</span><span>Surpresa</span></div>` : '';
                const pointValue = Math.floor((mission.points || 0) * multiplier);
                const iconClass = getIconClass(mission.icon);
                const iconColor = mission.color || '#1976d2';
                const expiresAt = mission.expiresAt ? new Date(mission.expiresAt).getTime() : null;
                const isTimed = !!expiresAt;
                const isExpired = isTimed && expiresAt <= Date.now();
                const diff = isTimed && !isExpired ? expiresAt - Date.now() : 0;
                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                const hotLabel = isExpired ? 'Expirada' : (hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
                const hotBadge = isTimed ? `<div class="quest-hot-badge" data-expires="${expiresAt}" style="${isExpired ? 'color: #999; text-decoration: line-through;' : ''}"><i class="fa-solid fa-clock"></i> <span>${hotLabel}</span></div>` : '';
                
                // Check if mission was already completed this period
                const lastKey = mission.frequency === 'daily' ? 'lastCustomDaily_' + mission.id
                              : mission.frequency === 'weekly' ? 'lastCustomWeekly_' + mission.id
                              : 'lastCustomMonthly_' + mission.id;
                const dateKey = mission.frequency === 'daily' ? todayStr
                             : mission.frequency === 'weekly' ? currentWeek
                             : currentMonth;
                
                const isCompleted = storedUser[lastKey] === dateKey || 
                                    (mission.id === 'sys_checkin' && storedUser.lastCheckIn === todayStr) ||
                                    (mission.id === 'sys_lunch' && storedUser.lastLunchWeek === currentWeek) ||
                                    (mission.id === 'sys_reuniao' && storedUser.lastReuniaoWeek === currentWeek) ||
                                    (mission.id === 'sys_embaixador' && storedUser.lastLinkedInMonth === currentMonth) ||
                                    (mission.id === 'sys_vivaengage' && storedUser.lastVivaEngageMonth === currentMonth) ||
                                    (mission.id === 'sys_jogos' && storedUser.lastGamesWeek === currentWeek);
                
                let buttonText = isCompleted ? 'Concluído' : 
                    (mission.validationType === 'photo' ? 'Enviar Foto' : 
                     mission.validationType === 'link' ? 'Enviar Link' : 'Validar');
                
                if (isExpired && !isCompleted) buttonText = 'Expirada';
                
                const buttonDisabled = (isCompleted || isExpired) ? 'disabled' : '';
                
                const adminActions = isAdmin ? `
                            <div class="admin-mission-actions">
                                <button class="btn-admin-action" onclick="editMission('${mission.id}')">Editar</button>
                                <button class="btn-admin-action btn-delete" onclick="deleteMission('${mission.id}')">Excluir</button>
                            </div>
                        ` : '';

                return `
                    <div class="quest-card custom-quest-card">
                        ${hotBadge}
                        ${surpriseBadge}
                        ${showFrequencyBadge ? `<div class="quest-badge ${mission.frequency}">${badgeLabel}</div>` : ''}
                        <i class="${iconClass} quest-main-icon" style="color: ${iconColor};"></i>
                        <h3>${mission.name}</h3>
                        <p>${mission.description}</p>
                        <div class="quest-footer">
                            <span class="pts-gain" style="display:flex; align-items:center; gap:4px; font-weight:700;">
                                +${pointValue}
                                <svg viewBox="0 0 100 100" width="16" height="16" style="filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));">
                                    <circle cx="68" cy="30" r="28" fill="#F1863B" />
                                    <ellipse cx="38" cy="38" rx="16" ry="14" fill="#2E7D32" />
                                    <ellipse cx="55" cy="32" rx="14" ry="13" fill="#388E3C" />
                                    <ellipse cx="68" cy="38" rx="15" ry="13" fill="#2E7D32" />
                                    <ellipse cx="50" cy="28" rx="13" ry="12" fill="#43A047" />
                                    <ellipse cx="42" cy="44" rx="12" ry="10" fill="#388E3C" />
                                    <ellipse cx="62" cy="44" rx="12" ry="10" fill="#2E7D32" />
                                    <ellipse cx="52" cy="22" rx="10" ry="9" fill="#4CAF50" />
                                    <path d="M 46 50 L 42 78 C 42 80 44 82 50 82 C 56 82 58 80 58 78 L 54 50 Z" fill="#1B5E20" />
                                    <line x1="22" y1="82" x2="78" y2="82" stroke="#1B5E20" stroke-width="3" stroke-linecap="round" />
                                </svg>
                            </span>
                            <button class="btn-checkin custom-mission-btn" ${buttonDisabled} data-mission-id="${mission.id}" data-mission-name="${mission.name}" data-mission-points="${mission.points}" data-validation-type="${mission.validationType}" data-frequency="${mission.frequency}">${buttonText}</button>
                        </div>
                        ${adminActions}
                    </div>
                `;
            })
            .join(''));

        const dashboardList = document.getElementById('dashboard-missions-list');
        if (dashboardList) {
            dashboardList.innerHTML = '';
            const topMissions = missions.filter(m => m.active && !m.surprise).slice(0, 4);
            dashboardList.insertAdjacentHTML('beforeend', topMissions.map(mission => {
                const iconClass = getIconClass(mission.icon);
                const pointValue = Math.floor((mission.points || 0) * multiplier);
                
                const lastKey = mission.frequency === 'daily' ? 'lastCustomDaily_' + mission.id
                              : mission.frequency === 'weekly' ? 'lastCustomWeekly_' + mission.id
                              : 'lastCustomMonthly_' + mission.id;
                const dateKey = mission.frequency === 'daily' ? todayStr
                             : mission.frequency === 'weekly' ? currentWeek
                             : currentMonth;
                const isCompleted = storedUser[lastKey] === dateKey || 
                                    (mission.id === 'sys_checkin' && storedUser.lastCheckIn === todayStr) ||
                                    (mission.id === 'sys_lunch' && storedUser.lastLunchWeek === currentWeek) ||
                                    (mission.id === 'sys_reuniao' && storedUser.lastReuniaoWeek === currentWeek) ||
                                    (mission.id === 'sys_embaixador' && storedUser.lastLinkedInMonth === currentMonth) ||
                                    (mission.id === 'sys_vivaengage' && storedUser.lastVivaEngageMonth === currentMonth) ||
                                    (mission.id === 'sys_jogos' && storedUser.lastGamesWeek === currentWeek);

                let buttonText = isCompleted ? 'Concluído' : 
                    (mission.validationType === 'photo' ? 'Enviar Foto' : 
                     mission.validationType === 'link' ? 'Enviar Link' : '+'+pointValue+' <svg viewBox="0 0 100 100" width="14" height="14" style="margin-bottom:-2px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));"><circle cx="68" cy="30" r="28" fill="#F1863B" /><ellipse cx="38" cy="38" rx="16" ry="14" fill="#2E7D32" /><ellipse cx="55" cy="32" rx="14" ry="13" fill="#388E3C" /><ellipse cx="68" cy="38" rx="15" ry="13" fill="#2E7D32" /><ellipse cx="50" cy="28" rx="13" ry="12" fill="#43A047" /><ellipse cx="42" cy="44" rx="12" ry="10" fill="#388E3C" /><ellipse cx="62" cy="44" rx="12" ry="10" fill="#2E7D32" /><ellipse cx="52" cy="22" rx="10" ry="9" fill="#4CAF50" /><path d="M 46 50 L 42 78 C 42 80 44 82 50 82 C 56 82 58 80 58 78 L 54 50 Z" fill="#1B5E20" /><line x1="22" y1="82" x2="78" y2="82" stroke="#1B5E20" stroke-width="3" stroke-linecap="round" /></svg>');
                     
                return `
                    <div class="mission-item">
                        <div class="mission-icon" style="background-color: ${mission.color || '#1976d2'}20; color: ${mission.color || '#1976d2'}">
                            <i class="${iconClass}"></i>
                        </div>
                        <div class="mission-details">
                            <h4>${mission.name}</h4>
                            <p>${isCompleted ? 'Missão cumprida!' : mission.description.substring(0, 40) + '...'}</p>
                        </div>
                        <button class="btn-checkin custom-mission-btn" ${isCompleted ? 'disabled' : ''} data-mission-id="${mission.id}" data-mission-name="${mission.name}" data-mission-points="${mission.points}" data-validation-type="${mission.validationType}" data-frequency="${mission.frequency}">
                            ${buttonText}
                        </button>
                    </div>
                `;
            }).join(''));
        }
    };

    const renderAdminMissionsList = () => {
        const body = document.getElementById('admin-missions-list-body');
        if (!body) return;

        const missions = getMissionData();
        if (missions.length === 0) {
            body.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #999;">Nenhuma missão cadastrada.</td></tr>';
            return;
        }

        body.innerHTML = missions.map(mission => {
            const freqLabel = mission.frequency === 'daily' ? 'Diária' : mission.frequency === 'weekly' ? 'Semanal' : 'Mensal';
            const statusLabel = mission.active ? 'Ativa' : 'Inativa';
            return `
                <tr>
                    <td><strong>${mission.name}</strong></td>
                    <td>${freqLabel}</td>
                    <td>${mission.points} ML Coins</td>
                    <td><span class="status-badge ${mission.active ? 'status-unlocked' : 'status-locked'}">${statusLabel}</span></td>
                    <td>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button onclick="editMission('${mission.id}')" class="btn-buy" style="padding:4px 8px; font-size:10px;">Editar</button>
                            <button onclick="deleteMission('${mission.id}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#d32f2f;">Excluir</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const handleMissionSubmit = async (e) => {
        e.preventDefault();
        
        console.log('Mission form submitted');
        
        const form = document.getElementById('mission-form');
        const editingId = form.dataset.editingId;

        const name = document.getElementById('mission-name').value;
        const frequency = document.getElementById('mission-frequency').value;
        const description = document.getElementById('mission-description').value;
        const points = parseInt(document.getElementById('mission-points').value);
        const icon = document.getElementById('mission-icon').value;
        const color = document.getElementById('mission-color').value;
        const validationType = document.getElementById('mission-validation-type').value;
        const active = document.getElementById('mission-active').checked;
        const surprise = document.getElementById('mission-surprise').checked;
        const rawDuration = parseInt(document.getElementById('mission-duration').value, 10);
        const durationHours = isNaN(rawDuration) ? 0 : rawDuration;
        const expiresAt = surprise && durationHours > 0 ? new Date(Date.now() + durationHours * 3600000).toISOString() : null;

        try {
            const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];

            if (editingId) {
                // Update existing
                const index = missions.findIndex(m => m.id === editingId);
                if (index !== -1) {
                    const safeDuration = isNaN(durationHours) ? 0 : durationHours;
                    const updatedMission = {
                        ...missions[index],
                        name,
                        frequency,
                        description,
                        points,
                        icon,
                        color,
                        validationType,
                        active,
                        surprise,
                        durationHours: surprise ? safeDuration : null,
                        expiresAt: (surprise && safeDuration > 0) ? (missions[index].expiresAt || new Date(Date.now() + safeDuration * 3600000).toISOString()) : null,
                        updatedAt: new Date().toISOString()
                    };
                    
                    // Firestore won't accept undefined values, so we clean the object
                    Object.keys(updatedMission).forEach(key => {
                        if (updatedMission[key] === undefined) {
                            delete updatedMission[key];
                        }
                    });
                    missions[index] = updatedMission;
                    localStorage.setItem('moura_leite_missions', JSON.stringify(missions));

                    if (dbAvailable && missionsCollection) {
                        try {
                            await missionsCollection.doc(editingId).set(updatedMission, { merge: true });
                            console.log('Mission updated in Firestore:', editingId);
                        } catch (firestoreError) {
                            console.error('Firestore update failed:', firestoreError);
                            alert('Missão atualizada localmente, mas não foi possível gravar no Firestore: ' + firestoreError.message);
                        }
                    }
                    alert('Missão atualizada com sucesso!');
                }
                
                delete form.dataset.editingId;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.textContent = 'Cadastrar Missão';
                const cancelBtn = document.getElementById('cancel-edit-mission-btn');
                if (cancelBtn) cancelBtn.classList.add('hidden');

            } else {
                // Create new
                const newMission = {
                    id: Date.now().toString(),
                    name,
                    frequency,
                    description,
                    points,
                    icon,
                    color,
                    validationType,
                    active,
                    surprise,
                    durationHours: surprise ? durationHours : null,
                    expiresAt,
                    createdAt: new Date().toISOString()
                };

                missions.push(newMission);
                localStorage.setItem('moura_leite_missions', JSON.stringify(missions));

                if (dbAvailable && missionsCollection) {
                    try {
                        await missionsCollection.doc(newMission.id).set(newMission);
                        console.log('Mission persisted to Firestore:', newMission.id);
                    } catch (firestoreError) {
                        console.error('Firestore write failed:', firestoreError);
                        alert('Missão salva localmente, mas não foi possível gravar no Firestore: ' + firestoreError.message);
                    }
                } else {
                    console.warn('Firestore unavailable, mission saved only locally.');
                }
                alert('Missão cadastrada com sucesso!');
            }
            
            // Reset form
            form.reset();
            document.getElementById('mission-color').value = '#1976d2';
            document.getElementById('mission-icon').value = '';
            // Reset preview
            const previewBox = document.getElementById('mission-icon-preview');
            if (previewBox) previewBox.innerHTML = '<i class="fa-solid fa-question" style="color: #1976d2;"></i>';
            renderCustomMissions();
            if (typeof renderAdminMissionsList === 'function') renderAdminMissionsList();
        } catch (error) {
            console.error('Erro ao salvar missão:', error);
            alert('Erro ao salvar missão: ' + error.message);
        }
    };

    window.deleteMission = async (missionId) => {
        if (!confirm('Deseja excluir esta missão permanentemente?')) return;
        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        const updated = missions.filter(m => m.id !== missionId);
        localStorage.setItem('moura_leite_missions', JSON.stringify(updated));
        if (dbAvailable && missionsCollection) {
            try {
                await missionsCollection.doc(missionId).delete();
            } catch (e) {
                console.error('Erro ao excluir missão no Firestore:', e);
            }
        }
        renderCustomMissions();
        if (typeof renderAdminMissionsList === 'function') renderAdminMissionsList();
        alert('Missão excluída com sucesso.');
    };

    window.editMission = async (missionId) => {
        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        const mission = missions.find(m => m.id === missionId);
        if (!mission) return alert('Missão não encontrada.');

        document.getElementById('mission-name').value = mission.name || '';
        document.getElementById('mission-frequency').value = mission.frequency || '';
        document.getElementById('mission-description').value = mission.description || '';
        document.getElementById('mission-points').value = mission.points || '';
        document.getElementById('mission-icon').value = mission.icon || '';
        document.getElementById('mission-color').value = mission.color || '#1976d2';
        document.getElementById('mission-validation-type').value = mission.validationType || '';
        document.getElementById('mission-active').checked = mission.active !== false;
        document.getElementById('mission-surprise').checked = mission.surprise || false;
        document.getElementById('mission-duration').value = mission.durationHours || '';

        // Trigger preview update
        const iconSelect = document.getElementById('mission-icon');
        if (iconSelect) {
            const event = new Event('change');
            iconSelect.dispatchEvent(event);
        }

        // Set editing state
        const form = document.getElementById('mission-form');
        form.dataset.editingId = mission.id;
        
        // Change submit button text
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.textContent = 'Salvar Alterações';
        }
        
        // Show cancel button
        const cancelBtn = document.getElementById('cancel-edit-mission-btn');
        if (cancelBtn) cancelBtn.classList.remove('hidden');

        // Switch to admin missions page and scroll to top
        showPage('admin-missions');
        window.scrollTo(0, 0);
    };

    // Admin Prizes Logic
    const prizesCollection = dbAvailable && dbInstance ? dbInstance.collection('custom_prizes') : null;
    let sharedPrizeCache = [];

    const getPrizeData = () => {
        const localPrizes = JSON.parse(localStorage.getItem('moura_leite_prizes')) || [];
        if (dbAvailable && sharedPrizeCache.length > 0) {
            return sharedPrizeCache;
        }
        return localPrizes;
    };

    const seedDefaultPrizes = () => {
        const SEED_VERSION = 'moura_leite_prizes_seeded_v1';
        if (!localStorage.getItem(SEED_VERSION)) {
            const defaults = [
                { id: 'prize_caneca', name: 'Caneca Personalizada', points: 450, icon: 'fa-mug-hot', color: '#f39c12', active: true, order: 1, createdAt: new Date().toISOString() },
                { id: 'prize_caderno', name: 'Caderno de Anotações', points: 300, icon: 'fa-book', color: '#1976d2', active: true, order: 2, createdAt: new Date().toISOString() },
                { id: 'prize_garrafa', name: 'Garrafa Térmica', points: 650, icon: 'fa-bottle-water', color: '#2ecc71', active: true, order: 3, createdAt: new Date().toISOString() },
                { id: 'prize_bone', name: 'Boné Moura Leite', points: 300, icon: 'svg-cap', color: '#9b59b6', active: true, order: 4, createdAt: new Date().toISOString() },
                { id: 'prize_oculos', name: 'Óculos de Sol', points: 450, icon: 'fa-glasses', color: '#e74c3c', active: true, order: 5, createdAt: new Date().toISOString() }
            ];
            
            let prizes = JSON.parse(localStorage.getItem('moura_leite_prizes')) || [];
            defaults.forEach(d => {
                const idx = prizes.findIndex(p => p.id === d.id);
                if (idx === -1) {
                    prizes.push(d);
                }
            });
            localStorage.setItem('moura_leite_prizes', JSON.stringify(prizes));
            localStorage.setItem(SEED_VERSION, 'true');
            
            if (dbAvailable && prizesCollection) {
                defaults.forEach(async d => {
                    try {
                        const docRef = prizesCollection.doc(d.id);
                        const docSnap = await docRef.get();
                        if (!docSnap.exists) {
                            await docRef.set(d, {merge: true});
                        }
                    } catch (e) {
                        console.warn('Error seeding prize:', e);
                    }
                });
            }
        }
    };

    const subscribeSharedPrizes = () => {
        if (!dbAvailable || !prizesCollection) return;
        prizesCollection.orderBy('createdAt', 'asc').onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
            // Skip events triggered by local writes (e.g. our own stock decrement transaction)
            // to avoid reverting optimistic UI updates before Firestore confirms
            if (snapshot.metadata.hasPendingWrites) return;

            if (!snapshot.empty) {
                sharedPrizeCache = [];
                snapshot.forEach((doc) => {
                    sharedPrizeCache.push(doc.data());
                });
                localStorage.setItem('moura_leite_prizes', JSON.stringify(sharedPrizeCache));
            }
            renderCustomPrizes();
            if (typeof renderAdminPrizesList === 'function') renderAdminPrizesList();
        }, (error) => {
            console.error('Error syncing shared prizes:', error);
            renderCustomPrizes();
            if (typeof renderAdminPrizesList === 'function') renderAdminPrizesList();
        });
    };

    const registerPrizeFormListener = () => {
        const form = document.getElementById('prize-form');
        if (form && !form.hasListener) {
            form.addEventListener('submit', handlePrizeSubmit);
            
            const iconSelect = document.getElementById('prize-icon');
            const colorInput = document.getElementById('prize-color');
            const imgInput = document.getElementById('prize-image');
            const previewBox = document.getElementById('prize-preview');

            const updatePreview = () => {
                if (!previewBox) return;
                const color = colorInput.value || '#006837';
                
                if (imgInput.files && imgInput.files[0]) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        previewBox.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
                        form.dataset.imageB64 = e.target.result;
                    };
                    reader.readAsDataURL(imgInput.files[0]);
                } else if (form.dataset.imageB64 && (!iconSelect.value || iconSelect.value === '')) {
                    previewBox.innerHTML = `<img src="${form.dataset.imageB64}" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
                } else {
                    const iconValue = iconSelect.value;
                    if (iconValue) {
                        form.dataset.imageB64 = ''; 
                    }
                    previewBox.innerHTML = getIconHTML(iconValue || 'fa-gift', color);
                }
            };

            if (iconSelect) iconSelect.addEventListener('change', () => { imgInput.value = ''; updatePreview(); });
            if (colorInput) colorInput.addEventListener('input', updatePreview);
            if (imgInput) imgInput.addEventListener('change', () => { iconSelect.value = ''; updatePreview(); });

            const cancelBtn = document.getElementById('cancel-edit-prize-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    form.reset();
                    if (document.getElementById('prize-desc')) document.getElementById('prize-desc').value = '';
                    delete form.dataset.editingId;
                    delete form.dataset.imageB64;
                    const submitBtn = form.querySelector('button[type="submit"]');
                    if (submitBtn) submitBtn.textContent = 'Cadastrar Prêmio';
                    cancelBtn.classList.add('hidden');
                    updatePreview();
                });
            }
            form.hasListener = true;
        }
    };

    const renderCustomPrizes = () => {
        const gridContainer = document.getElementById('store-grid-container');
        if (!gridContainer) return;
        
        gridContainer.querySelectorAll('.custom-prize-card').forEach(card => card.remove());

        const prizes = getPrizeData()
            .filter(p => p.active)
            .sort((a, b) => (parseInt(a.order) || 0) - (parseInt(b.order) || 0));
        
        prizes.forEach(prize => {
            const isBase64 = prize.image && prize.image.startsWith('data:image');
            const imgHTML = isBase64 
                ? `<div class="item-img"><img src="${prize.image}" style="max-width: 90%; max-height: 120px; object-fit: contain; border-radius: 8px;"></div>`
                : `<div class="item-img">${getIconHTML(prize.icon || 'fa-gift', prize.color || '#006837')}</div>`;
            
            // Stock logic: -1 = unlimited, 0 = sold out, >0 = available
            const qty = (prize.quantity === undefined || prize.quantity === null) ? -1 : parseInt(prize.quantity);
            const isSoldOut = qty === 0;
            const isUnlimited = qty === -1;
            
            let stockBadgeHTML = '';
            if (isSoldOut) {
                stockBadgeHTML = `<div class="stock-badge stock-badge--esgotado"><i class="fa-solid fa-ban"></i> Esgotado</div>`;
            } else if (!isUnlimited && qty <= 5) {
                stockBadgeHTML = `<div class="stock-badge stock-badge--low"><i class="fa-solid fa-box-open"></i> Últimas ${qty} unidades</div>`;
            } else if (!isUnlimited) {
                stockBadgeHTML = `<div class="stock-badge stock-badge--available"><i class="fa-solid fa-box"></i> ${qty} em estoque</div>`;
            }

            const html = `
                <div class="store-card custom-prize-card${isSoldOut ? ' store-card--esgotado' : ''}">
                    ${stockBadgeHTML}
                    ${imgHTML}
                    <h3>${prize.name}</h3>
                    ${prize.desc ? `<p class="store-card-desc">${prize.desc}</p>` : ''}
                    <div class="item-footer">
                        <span class="price" style="display:flex; align-items:center; gap:4px; justify-content:center;">
                            ${prize.points}
                            <svg viewBox="0 0 100 100" width="18" height="18" style="filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));">
                                <circle cx="68" cy="30" r="28" fill="#F1863B" />
                                <ellipse cx="38" cy="38" rx="16" ry="14" fill="#2E7D32" />
                                <ellipse cx="55" cy="32" rx="14" ry="13" fill="#388E3C" />
                                <ellipse cx="68" cy="38" rx="15" ry="13" fill="#2E7D32" />
                                <ellipse cx="50" cy="28" rx="13" ry="12" fill="#43A047" />
                                <ellipse cx="42" cy="44" rx="12" ry="10" fill="#388E3C" />
                                <ellipse cx="62" cy="44" rx="12" ry="10" fill="#2E7D32" />
                                <ellipse cx="52" cy="22" rx="10" ry="9" fill="#4CAF50" />
                                <path d="M 46 50 L 42 78 C 42 80 44 82 50 82 C 56 82 58 80 58 78 L 54 50 Z" fill="#1B5E20" />
                                <line x1="22" y1="82" x2="78" y2="82" stroke="#1B5E20" stroke-width="3" stroke-linecap="round" />
                            </svg>
                        </span>
                        <button class="btn-buy" ${isSoldOut ? 'disabled' : ''} onclick="buyItem('${prize.name}', ${prize.points}, '${prize.id}')">${isSoldOut ? 'Esgotado' : 'Trocar'}</button>
                    </div>
                </div>
            `;
            const boostCard = document.getElementById('boost-card');
            if (boostCard) {
                boostCard.insertAdjacentHTML('beforebegin', html);
            } else {
                gridContainer.insertAdjacentHTML('beforeend', html);
            }
        });
    };

    const renderAdminPrizesList = () => {
        const body = document.getElementById('admin-prizes-list-body');
        if (!body) return;

        const prizes = getPrizeData().sort((a, b) => (parseInt(a.order) || 0) - (parseInt(b.order) || 0));
        if (prizes.length === 0) {
            body.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #999;">Nenhum prêmio cadastrado.</td></tr>';
            return;
        }

        body.innerHTML = prizes.map(prize => {
            const qty = (prize.quantity === undefined || prize.quantity === null) ? -1 : parseInt(prize.quantity);
            const stockLabel = qty === -1 ? '<span style="color:#999;">Ilimitado</span>' : qty === 0 ? '<span style="color:#f44336; font-weight:700;">Esgotado</span>' : `<span style="color:${qty <= 5 ? '#e67e22' : '#4caf50'}; font-weight:700;">${qty} un.</span>`;
            return `
            <tr>
                <td><strong>${prize.order || 0}</strong></td>
                <td><strong>${prize.name}</strong></td>
                <td>${prize.points} ML Coins</td>
                <td>${stockLabel}</td>
                <td><span class="status-badge ${prize.active ? 'status-unlocked' : 'status-locked'}">${prize.active ? 'Ativo' : 'Inativo'}</span></td>
                <td>
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                        <button onclick="editPrize('${prize.id}')" class="btn-buy" style="padding:4px 8px; font-size:10px;">Editar</button>
                        <button onclick="deletePrize('${prize.id}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#d32f2f;">Excluir</button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
    };

    const handlePrizeSubmit = async (e) => {
        e.preventDefault();
        
        const form = document.getElementById('prize-form');
        const editingId = form.dataset.editingId;
        const name = document.getElementById('prize-name').value;
        const points = parseInt(document.getElementById('prize-points').value);
        const desc = document.getElementById('prize-desc') ? document.getElementById('prize-desc').value : '';
        const icon = document.getElementById('prize-icon').value;
        const color = document.getElementById('prize-color').value;
        const active = document.getElementById('prize-active').checked;
        const order = parseInt(document.getElementById('prize-order').value) || 0;
        const quantityRaw = document.getElementById('prize-quantity') ? parseInt(document.getElementById('prize-quantity').value) : -1;
        const quantity = isNaN(quantityRaw) ? -1 : quantityRaw;
        const imageB64 = form.dataset.imageB64 || null;

        try {
            const prizes = JSON.parse(localStorage.getItem('moura_leite_prizes')) || [];
            
            const prizeObj = {
                name,
                points,
                desc,
                icon,
                color,
                active,
                order,
                quantity,
                updatedAt: new Date().toISOString()
            };
            if (imageB64) prizeObj.image = imageB64;

            if (editingId) {
                const index = prizes.findIndex(p => p.id === editingId);
                if (index !== -1) {
                    const updated = { ...prizes[index], ...prizeObj };
                    
                    if (imageB64) {
                        updated.image = imageB64;
                        delete updated.icon;
                    } else if (icon) {
                        updated.icon = icon;
                        delete updated.image;
                    }

                    const hadImage = !!prizes[index].image;
                    const hadIcon = !!prizes[index].icon;

                    // remove undefined
                    Object.keys(updated).forEach(key => updated[key] === undefined && delete updated[key]);

                    prizes[index] = updated;
                    localStorage.setItem('moura_leite_prizes', JSON.stringify(prizes));
                    
                    renderCustomPrizes();
                    if (typeof renderAdminPrizesList === 'function') renderAdminPrizesList();

                    if (dbAvailable && prizesCollection) {
                        try {
                            const dbUpdate = { ...updated };
                            if (icon && hadImage) {
                                dbUpdate.image = firebase.firestore.FieldValue.delete();
                            } else if (imageB64 && hadIcon) {
                                dbUpdate.icon = firebase.firestore.FieldValue.delete();
                            }
                            await prizesCollection.doc(editingId).set(dbUpdate, { merge: true });
                        } catch (e) {
                            console.warn("Firestore error, mas salvo localmente:", e);
                        }
                    }
                    alert('Prêmio atualizado com sucesso!');
                }
                delete form.dataset.editingId;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.textContent = 'Cadastrar Prêmio';
                const cancelBtn = document.getElementById('cancel-edit-prize-btn');
                if (cancelBtn) cancelBtn.classList.add('hidden');
            } else {
                const newPrize = {
                    id: Date.now().toString(),
                    ...prizeObj,
                    createdAt: new Date().toISOString()
                };
                prizes.push(newPrize);
                localStorage.setItem('moura_leite_prizes', JSON.stringify(prizes));
                
                renderCustomPrizes();
                if (typeof renderAdminPrizesList === 'function') renderAdminPrizesList();

                if (dbAvailable && prizesCollection) {
                    try {
                        await prizesCollection.doc(newPrize.id).set(newPrize);
                    } catch (e) {
                        console.warn("Firestore error, mas salvo localmente:", e);
                    }
                }
                alert('Prêmio cadastrado com sucesso!');
            }

            form.reset();
            document.getElementById('prize-color').value = '#006837';
            document.getElementById('prize-icon').value = 'fa-gift';
            delete form.dataset.imageB64;
            const previewBox = document.getElementById('prize-preview');
            if (previewBox) previewBox.innerHTML = '<i class="fa-solid fa-gift" style="color: #006837;"></i>';
            
            renderCustomPrizes();
            if (typeof renderAdminPrizesList === 'function') renderAdminPrizesList();

        } catch (error) {
            console.error('Erro ao salvar prêmio:', error);
            alert('Erro ao salvar prêmio: ' + error.message);
        }
    };

    window.deletePrize = async (prizeId) => {
        if (!confirm('Deseja excluir este prêmio permanentemente?')) return;
        const prizes = JSON.parse(localStorage.getItem('moura_leite_prizes')) || [];
        const updated = prizes.filter(p => p.id !== prizeId);
        localStorage.setItem('moura_leite_prizes', JSON.stringify(updated));
        if (dbAvailable && prizesCollection) {
            try { await prizesCollection.doc(prizeId).delete(); } catch(e){}
        }
        renderCustomPrizes();
        if (typeof renderAdminPrizesList === 'function') renderAdminPrizesList();
        alert('Prêmio excluído com sucesso.');
    };

    window.editPrize = async (prizeId) => {
        const prizes = JSON.parse(localStorage.getItem('moura_leite_prizes')) || [];
        const prize = prizes.find(p => p.id === prizeId);
        if (!prize) return alert('Prêmio não encontrado.');

        document.getElementById('prize-name').value = prize.name || '';
        document.getElementById('prize-points').value = prize.points || '';
        if (document.getElementById('prize-desc')) document.getElementById('prize-desc').value = prize.desc || '';
        document.getElementById('prize-icon').value = prize.icon || '';
        document.getElementById('prize-color').value = prize.color || '#006837';
        document.getElementById('prize-active').checked = prize.active !== false;
        document.getElementById('prize-order').value = prize.order || 0;
        if (document.getElementById('prize-quantity')) {
            const qty = (prize.quantity === undefined || prize.quantity === null) ? -1 : prize.quantity;
            document.getElementById('prize-quantity').value = qty;
        }

        const form = document.getElementById('prize-form');
        form.dataset.editingId = prize.id;
        
        if (prize.image) {
            form.dataset.imageB64 = prize.image;
        }

        const iconSelect = document.getElementById('prize-icon');
        if (iconSelect) iconSelect.dispatchEvent(new Event('change'));

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Salvar Alterações';
        const cancelBtn = document.getElementById('cancel-edit-prize-btn');
        if (cancelBtn) cancelBtn.classList.remove('hidden');

        showPage('admin-prizes');
        window.scrollTo(0, 0);
    };

    window.resetUserPassword = async (email) => {
        const newPass = prompt(`Digite a nova senha para o usuário:`);
        if (newPass) {
            try {
                await db.collection("users").doc(email).update({ password: newPass });
                alert(`Senha alterada com sucesso!`);
                addNotification(`Senha resetada pelo administrador.`);
            } catch (e) {
                console.error(e);
                alert("Erro ao alterar senha.");
            }
        }
    };

    window.toggleUserStatus = async (email) => {
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const user = allUsers.find(u => u.email === email);
        if (user) {
            try {
                await db.collection("users").doc(email).update({ disabled: !user.disabled });
            } catch (e) {
                console.error(e);
                alert("Erro ao alterar status.");
            }
        }
    };

    window.reconcileAllUsersPoints = async () => {
        if (!confirm("⚠️ ATENÇÃO: Esta ferramenta irá ler o histórico de todos os usuários e recalcular os ML Coins totais com base nas missões concluídas. Isso irá sobrescrever os valores atuais no Firebase. Deseja continuar?")) return;
        
        const btn = event.target.closest('button');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';

        try {
            const usersSnap = await db.collection("users").get();
            const pointValues = {
                'Check-in Diário': 1,
                'Almoço Moura Leite': 5,
                'Reunião de Integração': 8,
                'Embaixador Digital': 15,
                'Engajamento Viva Engage': 12,
                'Dinâmica de Jogos': 20
            };

            let fixedCount = 0;

            for (const doc of usersSnap.docs) {
                const user = doc.data();
                const history = user.history || [];
                let calculatedPoints = 0;

                history.forEach(tx => {
                    // Only count successful/valid transactions
                    if (tx.status === 'Concluído' || tx.status === 'Validando' || tx.status === 'Ativo') {
                        // 1. Try to parse points from the new format: "item (+X pts)" or "item (-X pts)"
                        const earnedMatch = tx.item.match(/\(\+(\d+)\s+(?:pts|ML Coins|Moura Coins)\)/);
                        const spentMatch = tx.item.match(/\(\-(\d+)\s+(?:pts|ML Coins|Moura Coins)\)/);

                        if (earnedMatch) {
                            calculatedPoints += parseInt(earnedMatch[1]);
                        } else if (spentMatch) {
                            calculatedPoints -= parseInt(spentMatch[1]);
                        } else {
                            // 2. Legacy format - guess based on mission name
                            for (const [name, val] of Object.entries(pointValues)) {
                                if (tx.item.includes(name)) {
                                    calculatedPoints += val;
                                    break;
                                }
                            }
                        }
                    }
                });

                // Update server if different
                if (calculatedPoints !== (user.points || 0)) {
                    await db.collection("users").doc(user.email).update({ points: calculatedPoints });
                    fixedCount++;
                }
            }

            alert(`✅ Sucesso! Auditoria finalizada. ${fixedCount} usuários tiveram seus ML Coins corrigidos.`);
        } catch (error) {
            console.error("Erro na auditoria:", error);
            alert("Erro ao processar auditoria. Verifique o console.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };

    window.deleteUser = async (email) => {
        if (confirm(`Tem certeza que deseja EXCLUIR permanentemente o usuário ${email}?`)) {
            try {
                await db.collection("users").doc(email).delete();
                alert('Usuário excluído!');
            } catch (e) {
                console.error(e);
                alert("Erro ao excluir.");
            }
        }
    };

    window.editUser = async (email) => {
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const user = allUsers.find(u => u.email === email);
        if (user) {
            document.getElementById('edit-user-email').value = user.email;
            document.getElementById('edit-user-email-label').innerText = user.email;
            document.getElementById('edit-user-name').value = user.username || '';
            document.getElementById('edit-user-points').value = user.points || 0;
            document.getElementById('edit-user-dept').value = user.dept || '';
            document.getElementById('edit-user-dir').value = user.diretoria || '';
            
            document.getElementById('edit-user-modal').classList.remove('hidden');
        }
    };

    let userPoints = parseInt(storedUser.points) || 0;
    const pointsElement = document.getElementById('user-points');
    
    // Visit Tracking (Cumulative Days)
    const today = todayStr;
    const lastVisit = storedUser.lastVisit;

    if (lastVisit !== today) {
        storedUser.streak = (storedUser.streak || 0) + 1;
        storedUser.visitCount = (storedUser.visitCount || 0) + 1;
        storedUser.lastVisit = today;
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
    }

    // Rank Definitions — Níveis baseados em UTILIZAÇÃO de pontos (gastos na loja/boost)
    const ranks = [
        { name: 'Iniciante', min: 0, next: 500, icon: 'fa-seedling', class: 'rank-iniciante', multiplier: 1.0 },
        { name: 'Bronze', min: 501, next: 1500, icon: 'fa-medal', class: 'rank-bronze', multiplier: 1.1 },
        { name: 'Prata', min: 1501, next: 3000, icon: 'fa-award', class: 'rank-prata', multiplier: 1.2 },
        { name: 'Ouro', min: 3001, next: 6000, icon: 'fa-trophy', class: 'rank-ouro', multiplier: 1.5 },
        { name: 'Platina', min: 6001, next: 10000, icon: 'fa-crown', class: 'rank-platina', multiplier: 2.0 },
        { name: 'Diamante', min: 10001, next: Infinity, icon: 'fa-gem', class: 'rank-diamante', multiplier: 1.0 }
    ];

    // ── Calcula total de pontos GASTOS pelo usuário (loja + boost) ────────────
    const getUserSpentPoints = () => {
        const history = storedUser.history || [];
        let spent = 0;
        history.forEach(tx => {
            // Ignora transações recusadas/canceladas
            if (tx.status === 'Recusado' || tx.status === 'Cancelado') return;
            const spentMatch = (tx.item || '').match(/\(-(\d+)\s*(?:pts|ML Coins|Moura Coins)\)/);
            if (spentMatch) {
                spent += parseInt(spentMatch[1]);
            }
        });
        return spent;
    };

    // ── Multiplicador Base e Boost de Pontos ────────────────────────────────────
    const _baseMultiplier = () => {
        const spentPts = getUserSpentPoints();
        const currentRankObj = ranks.find((r, i) => spentPts <= r.next) || ranks[ranks.length-1];
        return currentRankObj.multiplier || 1.0;
    };

    const getCurrentMultiplier = () => {
        const base = _baseMultiplier();
        // Check if boost is active using server-synced time
        if (storedUser.boostActiveUntil && getServerTime() < storedUser.boostActiveUntil) {
            return base * 2;
        }
        return base;
    };

    // Update UI with User Data
    const updateUIWithUser = () => {
        // Find Current Rank based on SPENT points (utilização)
        const spentPts = getUserSpentPoints();
        const currentRankObj = ranks.find((r, i) => spentPts <= r.next) || ranks[ranks.length-1];
        const nextRankObj = ranks[ranks.indexOf(currentRankObj) + 1] || currentRankObj;
        
        const previousRank = storedUser.rank;
        storedUser.rank = currentRankObj.name;

        if (previousRank && previousRank !== currentRankObj.name) {
            const prevIndex = ranks.findIndex(r => r.name === previousRank);
            const currIndex = ranks.findIndex(r => r.name === currentRankObj.name);
            if (currIndex > prevIndex) {
                logSocialActivity(`atingiu o nível ${currentRankObj.name}! 🚀`, currentRankObj.icon);
            }
        }

        // Update Sidebar
        const sidebarName = document.querySelector('.user-info .name');
        const sidebarRank = document.querySelector('.user-info .rank');
        const userAvatar = document.getElementById('user-avatar-img');
        const streakElement = document.getElementById('user-streak');
        
        if (sidebarName) sidebarName.textContent = storedUser.username;
        if (sidebarRank) sidebarRank.textContent = storedUser.rank;
        if (userAvatar) {
            userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(storedUser.username)}&background=006837&color=fff`;
        }
        if (streakElement) {
            streakElement.textContent = `${storedUser.streak || 1} Dias`;
        }

        // Update Hero Progress
        const heroTitle = document.querySelector('.hero-text h1');
        const heroSub = document.querySelector('.hero-text p');
        const rankFill = document.querySelector('.rank-bar-fill');
        const rankLabels = document.querySelectorAll('.rank-labels span');
        const rankStatusText = document.querySelector('.rank-status');
        const heroRankIcon = document.getElementById('hero-rank-icon');

        if (heroTitle) heroTitle.textContent = `Olá, ${storedUser.username.split(' ')[0]}! 👋`;
        
        // Inject Hero Rank Icon
        if (heroRankIcon) {
            heroRankIcon.innerHTML = `<i class="fa-solid ${currentRankObj.icon}"></i>`;
            heroRankIcon.className = `hero-rank-badge ${currentRankObj.class}`;
        }
        
        if (currentRankObj !== nextRankObj) {
            const pointsForNext = nextRankObj.min - spentPts;
            if (heroSub) heroSub.innerHTML = `Resgate mais <strong>${pointsForNext} ML Coins</strong> em prêmios para subir ao nível <strong>${nextRankObj.name}</strong>.`;
            
            // Progress Bar Logic
            const range = nextRankObj.min - currentRankObj.min;
            const progress = ((spentPts - currentRankObj.min) / range) * 100;
            if (rankFill) rankFill.style.width = `${Math.max(5, progress)}%`;
            if (rankLabels.length >= 2) {
                rankLabels[0].textContent = currentRankObj.name;
                rankLabels[1].textContent = nextRankObj.name;
            }
            if (rankStatusText) rankStatusText.textContent = `${Math.floor(progress)}% concluído`;
        } else {
            if (heroSub) heroSub.innerHTML = `Parabéns! Você atingiu o nível máximo: <strong>${currentRankObj.name}</strong>.`;
            if (rankFill) rankFill.style.width = '100%';
            if (rankStatusText) rankStatusText.textContent = 'Nível Máximo Atingido';
            if (rankLabels.length >= 2) {
                const prevRank = ranks[ranks.indexOf(currentRankObj) - 1] || currentRankObj;
                rankLabels[0].textContent = prevRank.name;
                rankLabels[1].textContent = currentRankObj.name;
            }
        }

        // Update Goals Widget (Dynamic Integration)
        const metaText = document.getElementById('meta-text');
        const metaPercent = document.getElementById('meta-percent');
        const metaStatus = document.getElementById('meta-status');
        const circle = document.getElementById('main-progress');

        const totalGoals = 6;
        let completedGoals = 0;

        // Check Goal 1: Daily Check-in
        if (storedUser.lastCheckIn === todayStr || storedUser['lastCustomDaily_sys_checkin'] === todayStr) completedGoals++;

        // Check Goal 2: Weekly Lunch/Integração entre Times
        if (storedUser.lastLunchWeek === currentWeek || storedUser['lastCustomWeekly_sys_lunch'] === currentWeek) completedGoals++;

        // Check Goal 3: Weekly Reunião de Integração
        if (storedUser.lastReuniaoWeek === currentWeek || storedUser['lastCustomWeekly_sys_reuniao'] === currentWeek) completedGoals++;

        // Check Goal 4: Monthly Embaixador Digital
        if (storedUser.lastLinkedInMonth === currentMonth || storedUser['lastCustomMonthly_sys_embaixador'] === currentMonth) completedGoals++;

        // Check Goal 5: Monthly Viva Engage
        if (storedUser.lastVivaEngageMonth === currentMonth || storedUser['lastCustomMonthly_sys_vivaengage'] === currentMonth) completedGoals++;

        // Check Goal 6: Weekly Tarde dos Jogos
        if (storedUser.lastGamesWeek === currentWeek || storedUser['lastCustomWeekly_sys_jogos'] === currentWeek) completedGoals++;

        const percentage = (completedGoals / totalGoals) * 100;

        if (metaText) metaText.textContent = `Metas: ${completedGoals} de ${totalGoals} completadas`;
        if (metaPercent) metaPercent.textContent = `${Math.floor(percentage)}%`;
        if (metaStatus) {
            if (percentage === 0) metaStatus.textContent = 'Status: Iniciando';
            else if (percentage < 50) metaStatus.textContent = 'Status: Em progresso';
            else if (percentage < 100) metaStatus.textContent = 'Status: Muito bom';
            else metaStatus.textContent = 'Status: Excelente';
        }

        // Animate Circle
        if (circle) {
            const radius = circle.r.baseVal.value;
            const circumference = radius * 2 * Math.PI;
            circle.style.strokeDasharray = `${circumference} ${circumference}`;
            const offset = circumference - (percentage / 100 * circumference);
            
            setTimeout(() => {
                circle.style.strokeDashoffset = offset;
            }, 500);
        }

    };

    updateUIWithUser();

    // Achievement Management
    const updateAchievements = () => {
        const achCards = document.querySelectorAll('.achievement-card');
        const visits = storedUser.visitCount || 1;
        
        // Frequency (10 dias totais)
        if (visits >= 10) unlockAch(achCards[1]);
        // Centenário (100 dias totais)
        if (visits >= 100) unlockAch(achCards[2]);

        // Amigo da Galera (24 almoços)
        if ((storedUser.lunchCount || 0) >= 24) unlockAch(achCards[4]);

        // Porta Voz (10 LinkedIn)
        if ((storedUser.linkedInCount || 0) >= 10) unlockAch(achCards[5]);
    };

    function unlockAch(card) {
        if (card && card.classList.contains('locked')) {
            card.classList.remove('locked');
            card.classList.add('unlocked');
            card.querySelector('.lock-overlay')?.remove();
            
            // Add a "Unlocked" badge if it doesn't have a date yet
            if (!card.querySelector('.date-unlocked')) {
                const info = card.querySelector('.achievement-info');
                const badge = document.createElement('span');
                badge.className = 'date-unlocked';
                badge.textContent = 'Conquistado!';
                info.appendChild(badge);
            }
        }
    }

    // Update Ranking with All Users (excluding admin)
    const updateRanking = () => {
        const rankingContainer = document.querySelector('.ranking-list');
        if (!rankingContainer) return;

        // Get all users from global list
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        
        // Filter out admin and sort by points
        const sortedUsers = allUsers
            .filter(u => u.email !== 'admin@mouraleite.com.br')
            .sort((a, b) => b.points - a.points);

        if (sortedUsers.length === 0) {
            rankingContainer.innerHTML = '<p style="padding:1rem; color:#999; text-align:center;">Nenhum usuário no ranking.</p>';
            return;
        }

        rankingContainer.innerHTML = sortedUsers.slice(0, 7).map((user, index) => {
            const isMe = user.email === storedUser.email;
            const rankClass = index === 0 ? 'first' : (isMe ? 'me' : '');
            
            return `
                <div class="rank-item ${rankClass}">
                    <span class="pos">${index + 1}</span>
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=${index === 0 ? 'F1863B' : '006837'}&color=fff" alt="">
                    <span class="name">${isMe ? 'Você' : user.username}</span>
                    <span class="pts" style="display:flex; align-items:center; gap:4px;">
                        ${user.points.toLocaleString()} 
                        <svg viewBox="0 0 100 100" width="16" height="16" style="filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));">
                            <circle cx="68" cy="30" r="28" fill="#F1863B" />
                            <ellipse cx="38" cy="38" rx="16" ry="14" fill="#2E7D32" />
                            <ellipse cx="55" cy="32" rx="14" ry="13" fill="#388E3C" />
                            <ellipse cx="68" cy="38" rx="15" ry="13" fill="#2E7D32" />
                            <ellipse cx="50" cy="28" rx="13" ry="12" fill="#43A047" />
                            <ellipse cx="42" cy="44" rx="12" ry="10" fill="#388E3C" />
                            <ellipse cx="62" cy="44" rx="12" ry="10" fill="#2E7D32" />
                            <ellipse cx="52" cy="22" rx="10" ry="9" fill="#4CAF50" />
                            <path d="M 46 50 L 42 78 C 42 80 44 82 50 82 C 56 82 58 80 58 78 L 54 50 Z" fill="#1B5E20" />
                            <line x1="22" y1="82" x2="78" y2="82" stroke="#1B5E20" stroke-width="3" stroke-linecap="round" />
                        </svg>
                    </span>
                </div>
            `;
        }).join('');
    };

    updateRanking();

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Deseja realmente sair?')) {
                localStorage.removeItem('moura_leite_user');
                window.location.href = 'login.html';
            }
        });
    }

    // Modal Toggle for Ranks
    const btnVerNiveis = document.getElementById('btn-ver-niveis');
    const modalRanks = document.getElementById('ranks-modal');
    const btnCloseRanks = document.getElementById('close-ranks');

    if (btnVerNiveis) {
        btnVerNiveis.addEventListener('click', () => {
            modalRanks.classList.remove('hidden');
        });
    }

    if (btnCloseRanks) {
        btnCloseRanks.addEventListener('click', () => {
            modalRanks.classList.add('hidden');
        });
    }

    // Edit User Modal Logic
    const modalEditUser = document.getElementById('edit-user-modal');
    const btnCloseEditUser = document.getElementById('close-edit-user');
    const editUserForm = document.getElementById('edit-user-form');

    if (btnCloseEditUser) {
        btnCloseEditUser.addEventListener('click', () => {
            modalEditUser.classList.add('hidden');
        });
    }

    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('edit-user-email').value;
            const username = document.getElementById('edit-user-name').value;
            const points = parseInt(document.getElementById('edit-user-points').value) || 0;
            const dept = document.getElementById('edit-user-dept').value;
            const diretoria = document.getElementById('edit-user-dir').value;

            let updates = { username, points, dept, diretoria };
            
            try {
                // Fetch current user data to check for point changes
                const userDoc = await db.collection("users").doc(email).get();
                const userData = userDoc.data() || {};
                const oldPoints = parseInt(userData.points) || 0;

                // Log transaction if points were adjusted
                if (points !== oldPoints) {
                    const diff = points - oldPoints;
                    const serverTimestamp = getServerTime();
                    const tx = {
                        user: username,
                        item: `Ajuste Administrativo (${diff >= 0 ? '+' : ''}${diff} ML Coins)`,
                        date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
                        time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                        status: 'Concluído',
                        serverTime: serverTimestamp
                    };
                    if (!updates.history) updates.history = userData.history || [];
                    updates.history.unshift(tx);
                }

                await db.collection("users").doc(email).update(updates);
                console.log(`Usuário ${email} atualizado com sucesso no Firestore.`);
                
                // Update local session if editing self
                if (email === storedUser.email) {
                    userPoints = points; 
                    Object.assign(storedUser, updates);
                    localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                    updatePointsDisplay();
                    updateUIWithUser();
                }

                // Force update UI
                if (typeof renderAdminUsers === 'function') renderAdminUsers();
                if (typeof updateRanking === 'function') updateRanking();
                if (typeof renderHistory === 'function') renderHistory();

                alert('Usuário atualizado com sucesso!');
                modalEditUser.classList.add('hidden');
            } catch (err) {
                console.error("Erro ao editar usuário:", err);
                alert("Erro ao salvar alterações.");
            }
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modalRanks) {
            modalRanks.classList.add('hidden');
        }
        if (e.target === modalEditUser) {
            modalEditUser.classList.add('hidden');
        }
    });



    // Register mission form listener (after all functions are defined)
    registerMissionFormListener();
    setTimeout(registerMissionFormListener, 100);

    // Seed defaults
    seedDefaultMissions();

    // Subscribe to shared missions so all users see created missions
    subscribeSharedMissions();

    // Navigation handling
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.page-section');

    window.showPage = function(pageId) {
        // Hide all sections
        sections.forEach(sec => sec.classList.add('hidden'));
        
        // Show target section
        const targetSection = document.getElementById(`${pageId}-page`);
        if (targetSection) {
            targetSection.classList.remove('hidden');
            targetSection.classList.add('content-fade');
            
            // Special rendering for specific pages
            if (pageId === 'admin-users') renderAdminUsers();
            if (pageId === 'admin-missions') renderAdminMissions();
            if (pageId === 'missoes') renderCustomMissions();
            if (pageId === 'historico') renderHistory();
            if (pageId === 'conquistas') updateAchievements();
            if (pageId === 'ranking') renderFullRanking();
        }

        // Update active nav item
        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-page') === pageId) {
                item.classList.add('active');
            }
        });

        console.log(`Navigating to ${pageId}`);
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            showPage(page);
        });
    });

    // Store Logic
    window.buyItem = function(itemName, price, prizeId) {
        if (userPoints >= price) {
            const confirmPurchase = confirm(`Deseja trocar ${price} ML Coins por 1x ${itemName}?`);
            if (confirmPurchase) {
                const now = new Date(getServerTime());
                userPoints -= price;
                updatePointsDisplay();

                const newTransaction = {
                    user: storedUser.username,
                    item: `${itemName} (-${price} ML Coins)`,
                    date: now.toLocaleDateString('pt-BR'),
                    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído',
                    serverTime: getServerTime()
                };

                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(newTransaction);

                // Global history is obsolete, removed to save quota

                storedUser.points = userPoints;
                try {
                    localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                } catch(e) {}

                const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
                const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
                if (userIndex !== -1) {
                    allUsers[userIndex].points = userPoints;
                    allUsers[userIndex].history = storedUser.history;
                    try {
                        localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
                    } catch(e) {}
                }

                // Decrement prize stock if prizeId is provided
                if (prizeId) {
                    // 1. Update localStorage and cache immediately (optimistic UI)
                    const prizes = JSON.parse(localStorage.getItem('moura_leite_prizes')) || [];
                    const pIdx = prizes.findIndex(p => p.id === prizeId);
                    if (pIdx !== -1) {
                        const currentQty = (prizes[pIdx].quantity === undefined || prizes[pIdx].quantity === null) ? -1 : parseInt(prizes[pIdx].quantity);
                        if (currentQty > 0) {
                            const newQty = currentQty - 1;
                            prizes[pIdx].quantity = newQty;
                            try { localStorage.setItem('moura_leite_prizes', JSON.stringify(prizes)); } catch(e) {}

                            // Update in-memory cache so onSnapshot doesn't revert
                            const cIdx = sharedPrizeCache.findIndex(p => p.id === prizeId);
                            if (cIdx !== -1) sharedPrizeCache[cIdx].quantity = newQty;

                            // 2. Firestore: use runTransaction for atomic decrement (prevents race with onSnapshot)
                            if (dbAvailable && prizesCollection) {
                                const prizeDocRef = prizesCollection.doc(prizeId);
                                db.runTransaction(async (transaction) => {
                                    const snap = await transaction.get(prizeDocRef);
                                    if (!snap.exists) return;
                                    const serverQty = (snap.data().quantity === undefined || snap.data().quantity === null) ? -1 : parseInt(snap.data().quantity);
                                    if (serverQty > 0) {
                                        transaction.update(prizeDocRef, { quantity: serverQty - 1 });
                                    }
                                }).catch(e => console.warn('Erro na transação de estoque:', e));
                            }
                        }
                    }
                    renderCustomPrizes();
                }

                // Sync to Firestore
                saveAndSync();

                updateRanking();
                updateUIWithUser();
                addNotification(`Você resgatou: ${itemName}. Retire no RH!`);
                alert(`Sucesso! Você adquiriu: ${itemName}. Retire seu item no RH.`);
            }
        } else {
            alert(`ML Coins insuficientes! Você precisa de mais ${price - userPoints} ML Coins para este item.`);
        }
    };

    // ── Boost de Pontos 2x ─────────────────────────────────────────────────────
    // Uses Firebase server timestamp as single source of truth to prevent cheating.

    const initBoostUI = () => {
        const btn = document.getElementById('boost-btn');
        if (!btn) return;

        const serverNow = new Date(getServerTime());
        const boostMonth = (serverNow.getMonth() + 1) + '-' + serverNow.getFullYear();

        // Check if boost was already bought this month (stored in Firestore)
        if (storedUser.lastBoostMonth === boostMonth) {
            btn.disabled = true;
            btn.textContent = 'Usado ✓';
            return;
        }

        // Check if boost is currently active
        if (storedUser.boostActiveUntil && getServerTime() < storedUser.boostActiveUntil) {
            btn.disabled = true;
            const remaining = Math.ceil((storedUser.boostActiveUntil - getServerTime()) / 3600000);
            btn.textContent = `Ativo (${remaining}h)`;
        }
    };

    window.buyBoost = async function() {
        const price = 50;
        if (userPoints < price) {
            alert(`ML Coins insuficientes! Você precisa de mais ${price - userPoints} ML Coins.`);
            return;
        }

        // Validate via Firebase server timestamp (anti-cheat)
        if (!dbAvailable) {
            alert('É necessário conexão com o servidor para ativar o Boost. Tente novamente.');
            return;
        }

        try {
            // ALWAYS write a fresh server timestamp first, then read it back.
            // This prevents the "time machine" bug where a stale timestamp freezes dates.
            await db.collection('_server_time').doc('sync').set({
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            const fresh = await db.collection('_server_time').doc('sync').get();
            const serverNow = fresh.data().timestamp.toDate();

            const boostMonth = (serverNow.getMonth() + 1) + '-' + serverNow.getFullYear();
            const userDoc = await db.collection('users').doc(storedUser.email).get();
            const userData = userDoc.data() || {};

            // Check monthly limit in Firestore (not localStorage, to prevent manipulation)
            if (userData.lastBoostMonth === boostMonth) {
                alert('Você já usou o Boost este mês. Disponível novamente no próximo mês.');
                const btn = document.getElementById('boost-btn');
                if (btn) { btn.disabled = true; btn.textContent = 'Usado ✓'; }
                return;
            }

            const confirmed = confirm(`Deseja ativar o Boost 2x por ${price} ML Coins?\nSeus ML Coins em missões serão dobrados por 24 horas.`);
            if (!confirmed) return;

            // Calculate boost expiry: 24h from server time
            const boostUntilTs = serverNow.getTime() + 86400000; // +24h

            userPoints -= price;
            storedUser.points = userPoints;
            storedUser.lastBoostMonth = boostMonth;
            storedUser.boostActiveUntil = boostUntilTs;

            const now = new Date(serverNow);
            const transaction = {
                user: storedUser.username,
                item: `Boost de Pontos 2x (24h) (-${price} ML Coins)`,
                date: now.toLocaleDateString('pt-BR'),
                time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                status: 'Ativo',
                serverTime: serverNow.getTime()
            };
            if (!storedUser.history) storedUser.history = [];
            storedUser.history.unshift(transaction);

            try {
                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(transaction);
                if (globalHistory.length > 200) globalHistory.length = 200;
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
            } catch(e) {}

            // Persist to Firestore (authoritative record)
            saveAndSync();

            updatePointsDisplay();
            updateRanking();
            updateUIWithUser();
            initBoostUI();
            addNotification('🚀 Boost 2x ativado! Suas missões valem o dobro por 24h.');
            alert('🚀 Boost ativado! Suas missões valem 2x por 24 horas. Bora completar missões!');

        } catch (err) {
            console.error('Boost error:', err);
            alert('Erro ao ativar o Boost. Tente novamente.');
        }
    };

    // Removed duplicate multiplier logic here

    initBoostUI();

    window.rejectTransaction = async (email, originalIndex) => {
        if (!confirm('Deseja realmente recusar este crédito e remover os ML Coins do usuário?')) return;
        
        try {
            const userDoc = await db.collection("users").doc(email).get();
            if (!userDoc.exists) return alert("Usuário não encontrado no banco.");
            
            const userData = userDoc.data();
            const history = userData.history || [];
            
            if (originalIndex < 0 || originalIndex >= history.length) {
                return alert("Transação não encontrada no histórico do usuário.");
            }
            
            const tx = history[originalIndex];
            if (tx.status === 'Recusado') return alert("Esta transação já foi recusada.");
            
            // Parse points from item string
            let pointsToDeduct = 0;
            const earnedMatch = tx.item.match(/\(\+(\d+)\s+(?:pts|ML Coins|Moura Coins)\)/);
            if (earnedMatch) {
                pointsToDeduct = parseInt(earnedMatch[1]);
            } else {
                // Try legacy parsing
                const pointValues = {
                    'Check-in Diário': 1,
                    'Almoço Moura Leite': 5,
                    'Reunião de Integração': 8,
                    'Embaixador Digital': 15,
                    'Engajamento Viva Engage': 12,
                    'Dinâmica de Jogos': 20
                };
                for (const [name, val] of Object.entries(pointValues)) {
                    if (tx.item.includes(name)) {
                        pointsToDeduct = val;
                        break;
                    }
                }
                // Custom missions legacy parsing
                const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
                const matchedMission = missions.find(m => tx.item.includes(m.name));
                if (matchedMission) {
                    pointsToDeduct = matchedMission.points || 0;
                }
            }
            
            // Update transaction status
            history[originalIndex].status = 'Recusado';
            
            // CLEANUP: Remove base64 images from history before saving to avoid 1MB limit errors
            const cleanedHistory = history.map(tx => {
                const cleanedTx = { ...tx };
                if (cleanedTx.photoData && cleanedTx.photoData.startsWith('data:image')) {
                    cleanedTx.photoData = '[EVIDENCIA_SALVA]';
                }
                return cleanedTx;
            });
            
            // Update points
            const newPoints = Math.max(0, (parseInt(userData.points) || 0) - pointsToDeduct);
            
            await db.collection("users").doc(email).update({
                history: cleanedHistory,
                points: newPoints
            });
            
            alert(`Transação recusada e ${pointsToDeduct} ML Coins removidos com sucesso!`);
            
        } catch (e) {
            console.error(e);
            alert("Erro ao recusar transação.");
        }
    };

    // ==========================================
    // ADMIN: Reset Mission Cooldown for a User
    // ==========================================
    // Clears the completion flag of a mission for a specific user,
    // allowing them to complete it again in the same period.
    // Usage via console: adminResetMission('email@usuario.com', 'sys_lunch')
    // Common mission IDs: sys_lunch, sys_reuniao, sys_jogos, sys_checkin,
    //                     sys_embaixador, sys_vivaengage, or any custom mission ID.
    window.adminResetMission = async (userEmail, missionId) => {
        if (storedUser.email !== 'admin@mouraleite.com.br') {
            return alert('Apenas o administrador pode executar esta ação.');
        }
        if (!userEmail || !missionId) {
            return alert('Uso: adminResetMission("email@usuario.com", "idDaMissao")');
        }

        const frequencyKeyMap = {
            sys_checkin:     ['lastCheckIn',         'lastCustomDaily_sys_checkin'],
            sys_lunch:       ['lastLunchWeek',        'lastCustomWeekly_sys_lunch'],
            sys_reuniao:     ['lastReuniaoWeek',      'lastCustomWeekly_sys_reuniao'],
            sys_jogos:       ['lastGamesWeek',        'lastCustomWeekly_sys_jogos'],
            sys_embaixador:  ['lastLinkedInMonth',    'lastCustomMonthly_sys_embaixador'],
            sys_vivaengage:  ['lastVivaEngageMonth',  'lastCustomMonthly_sys_vivaengage'],
        };

        // Build the list of fields to clear
        const fieldsToClear = {};
        if (frequencyKeyMap[missionId]) {
            frequencyKeyMap[missionId].forEach(key => { fieldsToClear[key] = null; });
        } else {
            // For custom missions, try all frequency variants
            ['lastCustomDaily_', 'lastCustomWeekly_', 'lastCustomMonthly_'].forEach(prefix => {
                fieldsToClear[prefix + missionId] = null;
            });
        }

        if (!confirm(`Resetar cooldown da missão "${missionId}" para ${userEmail}?`)) return;

        try {
            if (dbAvailable) {
                // Use FieldValue.delete() to fully remove the field from Firestore
                const updates = {};
                Object.keys(fieldsToClear).forEach(k => {
                    updates[k] = firebase.firestore.FieldValue.delete();
                });
                await db.collection('users').doc(userEmail).update(updates);
            }

            // Also clear from localStorage for the currently logged-in user (if it's them)
            const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
            const idx = allUsers.findIndex(u => u.email === userEmail);
            if (idx !== -1) {
                Object.keys(fieldsToClear).forEach(k => { delete allUsers[idx][k]; });
                localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
            }
            if (storedUser.email === userEmail) {
                Object.keys(fieldsToClear).forEach(k => { delete storedUser[k]; });
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                renderCustomMissions();
            }

            alert(`✅ Cooldown da missão "${missionId}" resetado para ${userEmail}!\nO usuário já pode completá-la novamente.`);
        } catch (err) {
            console.error('Erro ao resetar cooldown:', err);
            alert('Erro ao resetar cooldown. Veja o console para detalhes.');
        }
    };

    // Pagination Variables
    let currentHistoryPage = 1;
    const historyItemsPerPage = 50;
    let fullHistoryData = [];

    // Helper: deduplicate history entries by exact match (including serverTime)
    const deduplicateHistory = (entries) => {
        const seen = new Set();
        return entries.filter(tx => {
            // Include serverTime (milliseconds) so that two legitimate actions done in the same minute by the user are NOT treated as duplicates.
            // Only exact bug-clones (with the exact same serverTime or both missing it) will be removed.
            const key = `${tx.serverTime || ''}_${tx.item || ''}_${tx.user || ''}_${tx.date || ''}_${tx.time || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    // History Rendering
    const renderHistory = (page = null) => {
        if (page !== null) currentHistoryPage = page;
        
        // Free up localStorage space by deleting the obsolete global history
        try { localStorage.removeItem('moura_leite_global_history'); } catch(e) {}
        
        const historyBody = document.querySelector('#historico-page .history-table tbody');
        const historyHeader = document.querySelector('#historico-page .history-table thead tr');
        const isAdmin = storedUser.email === 'admin@mouraleite.com.br';
        
        fullHistoryData = [];

        if (isAdmin) {
            // Admin: force fetch from server to ensure fresh data
            if (dbAvailable) {
                db.collection('users').get({ source: 'server' }).then(snapshot => {
                    const allTx = [];
                    snapshot.forEach(doc => {
                        const u = doc.data();
                        if (u.history && Array.isArray(u.history)) {
                            u.history.forEach((tx, i) => {
                                allTx.push({ ...tx, user: tx.user || u.username, email: u.email, originalIndex: i });
                            });
                        }
                    });
                    // Deduplicate and sort
                    const deduped = deduplicateHistory(allTx);
                    deduped.sort((a, b) => (b.serverTime || 0) - (a.serverTime || 0));
                    fullHistoryData = deduped;
                    _renderHistoryTable(historyBody, historyHeader, isAdmin);
                }).catch(err => {
                    console.warn('Erro ao buscar histórico do Firestore, usando localStorage:', err);
                    _loadHistoryFromLocal(isAdmin);
                    _renderHistoryTable(historyBody, historyHeader, isAdmin);
                });
                return; // will render async
            } else {
                _loadHistoryFromLocal(isAdmin);
            }
        } else {
            // Regular user: read from in-memory storedUser to avoid localStorage quota freeze bugs
            const rawHistory = storedUser.history || [];
            fullHistoryData = deduplicateHistory(rawHistory);
        }
        
        _renderHistoryTable(historyBody, historyHeader, isAdmin);
    };

    const _loadHistoryFromLocal = (isAdmin) => {
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const allTx = [];
        allUsers.forEach(u => {
            if (u.history && Array.isArray(u.history)) {
                u.history.forEach((tx, i) => {
                    allTx.push({ ...tx, user: tx.user || u.username, email: u.email, originalIndex: i });
                });
            }
        });
        const deduped = deduplicateHistory(allTx);
        deduped.sort((a, b) => (b.serverTime || 0) - (a.serverTime || 0));
        fullHistoryData = deduped;
    };

    const _renderHistoryTable = (historyBody, historyHeader, isAdmin) => {
        if (!historyBody || !historyHeader) return;

        // Update Header
        if (isAdmin) {
            historyHeader.innerHTML = `
                <th>Usuário</th>
                <th>Item</th>
                <th>Evidência</th>
                <th>Data</th>
                <th>Horário</th>
                <th>Status</th>
                <th>Ações</th>
            `;
        } else {
            historyHeader.innerHTML = `
                <th>Item</th>
                <th>Data</th>
                <th>Horário</th>
                <th>Status</th>
            `;
        }

        const paginationContainer = document.getElementById('history-pagination');

        if (fullHistoryData.length === 0) {
            const colCount = isAdmin ? 6 : 4;
            historyBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; padding: 2rem; color: #999;">Nenhum registro encontrado ainda.</td></tr>`;
            if (paginationContainer) paginationContainer.classList.add('hidden');
            return;
        }

        // Pagination Logic
        const totalPages = Math.ceil(fullHistoryData.length / historyItemsPerPage);
        if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;
        if (currentHistoryPage < 1) currentHistoryPage = 1;

        const startIndex = (currentHistoryPage - 1) * historyItemsPerPage;
        const endIndex = startIndex + historyItemsPerPage;
        const pageData = fullHistoryData.slice(startIndex, endIndex);

        historyBody.innerHTML = pageData.map(tx => `
            <tr>
                ${isAdmin ? `<td><strong>${tx.user}</strong></td>` : ''}
                <td>${(tx.item || '').replace(/pts|Moura Coins/gi, 'ML Coins')}</td>
                ${isAdmin ? `
                    <td style="text-align:center;">
                        ${tx.evidenceId ? `<button class="view-photo-btn" onclick="viewPhoto(null, '${tx.evidenceId}')" title="Ver Comprovante">📸</button>` : (tx.photo ? `<button class="view-photo-btn" onclick="viewPhoto('${tx.photo}')" title="Ver Comprovante">📸</button>` : '')}
                        ${tx.link ? `<a href="${tx.link}" target="_blank" class="view-link-btn" title="Ver Publicação" style="text-decoration:none; margin-left:5px;">🔗</a>` : ''}
                        ${(!tx.photo && !tx.evidenceId && !tx.link) ? '<span style="color:#ccc">-</span>' : ''}
                    </td>
                ` : ''}
                <td>${tx.date}</td>
                <td>${tx.time}</td>
                <td><span class="status-badge">${tx.status}</span></td>
                ${isAdmin ? `
                    <td style="text-align:center;">
                        ${(tx.status === 'Concluído' || tx.status === 'Validando') ? 
                        `<button class="btn-buy" style="background:#d32f2f; padding:4px 8px; font-size:10px; border-radius:4px; color:#fff; border:none; cursor:pointer;" onclick="rejectTransaction('${tx.email}', ${tx.originalIndex})">Recusar</button>` 
                        : '<span style="color:#ccc">-</span>'}
                    </td>
                ` : ''}
            </tr>
        `).join('');

        // Update Pagination UI
        if (paginationContainer) {
            if (totalPages > 1) {
                paginationContainer.classList.remove('hidden');
                
                const prevBtn = document.getElementById('history-prev');
                const nextBtn = document.getElementById('history-next');
                const pageInfo = document.getElementById('history-page-info');
                
                if (pageInfo) pageInfo.textContent = `Página ${currentHistoryPage} de ${totalPages}`;
                
                if (prevBtn) {
                    prevBtn.disabled = currentHistoryPage === 1;
                    prevBtn.onclick = () => {
                        renderHistory(currentHistoryPage - 1);
                        document.getElementById('historico-page').scrollIntoView({ behavior: 'smooth' });
                    };
                }
                
                if (nextBtn) {
                    nextBtn.disabled = currentHistoryPage === totalPages;
                    nextBtn.onclick = () => {
                        renderHistory(currentHistoryPage + 1);
                        document.getElementById('historico-page').scrollIntoView({ behavior: 'smooth' });
                    };
                }
            } else {
                paginationContainer.classList.add('hidden');
            }
        }
    };

    // Make it available globally if needed for click handlers
    window.renderHistory = renderHistory;

    // Admin Tool: Clean duplicate history entries in Firestore for all users
    window.cleanDuplicateHistory = async () => {
        if (!dbAvailable) { alert('Firebase não disponível.'); return; }
        const confirmed = confirm('Isso vai percorrer TODOS os usuários no Firebase e remover entradas duplicadas do histórico.\n\nDeseja continuar?');
        if (!confirmed) return;

        try {
            const snapshot = await db.collection('users').get();
            let totalCleaned = 0;
            const batch = db.batch();

            snapshot.forEach(doc => {
                const u = doc.data();
                if (!u.history || !Array.isArray(u.history)) return;

                const seen = new Set();
                const cleanHistory = u.history.filter(tx => {
                    // Same key as renderHistory deduplication (including serverTime)
                    const key = `${tx.serverTime || ''}_${tx.item || ''}_${tx.user || ''}_${tx.date || ''}_${tx.time || ''}`;
                    if (seen.has(key)) { totalCleaned++; return false; }
                    seen.add(key);
                    // Also strip any leftover base64 photos
                    if (tx.photo && typeof tx.photo === 'string' && tx.photo.length > 500) {
                        tx.photo = '[EVIDENCIA_SALVA]';
                        tx.hasPhoto = true;
                    }
                    return true;
                });

                if (cleanHistory.length !== u.history.length) {
                    batch.update(doc.ref, { history: cleanHistory });
                }
            });

            await batch.commit();
            alert(`✅ Limpeza concluída!\n${totalCleaned} entradas duplicadas foram removidas do Firestore.\n\nRecarregue a página para ver o histórico atualizado.`);
        } catch (err) {
            console.error('Erro ao limpar duplicatas:', err);
            alert('Erro ao limpar duplicatas. Veja o console para detalhes.');
        }
    };

    // Admin Tool: Reconcile points for all users based on their history
    window.reconcileAllUsersPoints = async () => {
        if (!dbAvailable) { alert('Firebase não disponível.'); return; }
        const confirmed = confirm('Isso vai recalcular e corrigir os ML Coins de TODOS os colaboradores com base no histórico de transações.\n\nDeseja continuar?');
        if (!confirmed) return;

        // Known points for old entries that didn't have (+X pts) in the string
        const KNOWN_MISSION_POINTS = {
            'Check-in Diário': 1,
            'Integração entre Times': 5,
            'Café de Integração': 5,
            'Almoço Moura Leite': 5,
            'Reunião de Integração': 8,
            'Embaixador Digital': 15,
            'Engajamento Viva Engage': 12,
            'Dinâmica de Jogos': 20
        };
        const KNOWN_ITEMS = {
            'Caneca': -450,
            'Caderno': -300,
            'Garrafa': -650,
            'Boné': -300,
            'Óculos de Sol': -450,
            'Boost de Pontos 2x': -50
        };

        try {
            // Fetch custom mission points first
            const missionsSnap = await db.collection("custom_missions").get();
            const customMissionPoints = {};
            missionsSnap.forEach(doc => {
                const m = doc.data();
                customMissionPoints[m.name] = m.points;
            });

            const snapshot = await db.collection('users').get();
            const batch = db.batch();
            let usersUpdated = 0;

            snapshot.forEach(doc => {
                const u = doc.data();
                if (u.email === 'admin@mouraleite.com.br') return;
                if (!u.history || !Array.isArray(u.history)) return;

                // Sum points from history
                let calculatedPoints = 0;
                u.history.forEach(tx => {
                    if (tx.status === 'Recusado' || tx.status === 'Cancelado') return;
                    
                    const itemText = tx.item || '';
                    const match = itemText.match(/\(([+-]?\d+)\s*(?:pts?|ML Coins|Moura Coins)\)/i);
                    
                    if (match) {
                        calculatedPoints += parseInt(match[1]);
                    } else {
                        // Fallback for old history formats
                        if (itemText.startsWith('Missão:')) {
                            const missionPart = itemText.replace('Missão: ', '').trim();
                            let found = false;
                            for (const [name, pts] of Object.entries(KNOWN_MISSION_POINTS)) {
                                if (missionPart.includes(name)) { calculatedPoints += pts; found = true; break; }
                            }
                            if (!found) {
                                for (const [name, pts] of Object.entries(customMissionPoints)) {
                                    if (missionPart.includes(name)) { calculatedPoints += parseInt(pts); break; }
                                }
                            }
                        } else {
                            for (const [name, pts] of Object.entries(KNOWN_ITEMS)) {
                                if (itemText.includes(name)) { calculatedPoints += pts; break; }
                            }
                        }
                    }
                });

                if (calculatedPoints !== (u.points || 0)) {
                    batch.update(doc.ref, { points: Math.max(0, calculatedPoints) });
                    usersUpdated++;
                }
            });

            await batch.commit();
            alert(`✅ Recálculo concluído!\n${usersUpdated} colaboradores tiveram os ML Coins corrigidos.\n\nRecarregue a página para ver as atualizações.`);
        } catch (err) {
            console.error('Erro ao recalcular pontos:', err);
            alert('Erro ao recalcular ML Coins. Veja o console para detalhes.');
        }
    };


    const renderFullRanking = () => {
        const fullRankingBody = document.getElementById('full-ranking-body');
        if (!fullRankingBody) return;

        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const sortedUsers = allUsers
            .filter(u => u.email !== 'admin@mouraleite.com.br')
            .sort((a, b) => b.points - a.points);

        fullRankingBody.innerHTML = sortedUsers.map((user, index) => {
            const deptDisplay = user.dept ? (user.dept.length <= 3 ? user.dept.toUpperCase() : user.dept.charAt(0).toUpperCase() + user.dept.slice(1)) : 'Geral';
            const dirRaw = user.diretoria ? user.diretoria.replace(/^diretoria-/i, '') : '';
            const dirDisplay = dirRaw ? (dirRaw.charAt(0).toUpperCase() + dirRaw.slice(1)) : 'Moura Leite';
            
            return `
                <tr>
                    <td><strong>${index + 1}º</strong></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=006837&color=fff" style="width:30px; border-radius:50%;">
                            <span>${user.username}</span>
                        </div>
                    </td>
                    <td>${deptDisplay}</td>
                    <td>${dirDisplay}</td>
                    <td><strong>${user.points.toLocaleString()} ML Coins</strong></td>
                </tr>
            `;
        }).join('');
    };

    function updatePointsDisplay() {
        if (pointsElement) {
            pointsElement.innerHTML = userPoints.toLocaleString();
        }
    }

    // Notifications Logic
    const renderNotifications = () => {
        const notifList = document.getElementById('notif-list');
        const notifBadge = document.getElementById('notif-badge');
        const notifications = storedUser.notifications || [];
        
        if (!notifList || !notifBadge) return;

        notifBadge.textContent = notifications.length;
        notifBadge.style.display = notifications.length > 0 ? 'flex' : 'none';

        if (notifications.length === 0) {
            notifList.innerHTML = '<p style="padding:1rem; font-size:0.8rem; color:#999; text-align:center;">Nenhuma notificação nova.</p>';
            return;
        }

        notifList.innerHTML = notifications.map(n => `
            <div class="notif-item">
                <p>${n.text}</p>
                <span>${n.time}</span>
            </div>
        `).join('');
    };

    const addNotification = (text) => {
        if (!storedUser.notifications) storedUser.notifications = [];
        const now = new Date();
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        storedUser.notifications.unshift({ text, time: timeStr });
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        renderNotifications();
    };

    // Initial Notification for new users
    if (!storedUser.notifications || storedUser.notifications.length === 0) {
        addNotification(`Bem-vindo ao portal, ${storedUser.username}! Comece completando suas missões.`);
    }

    // Toggle Dropdown
    const notifBtn = document.getElementById('notification-btn');
    const notifDropdown = document.getElementById('notif-dropdown');
    if (notifBtn) {
        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', () => {
        if (notifDropdown) notifDropdown.classList.add('hidden');
    });

    if (notifDropdown) {
        notifDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    const clearNotifsBtn = document.getElementById('clear-notifs');
    if (clearNotifsBtn) {
        clearNotifsBtn.addEventListener('click', () => {
            storedUser.notifications = [];
            localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
            renderNotifications();
        });
    }

    renderNotifications();

    // Save evidence (photo/link) to separate Firestore collection to avoid 1MB doc limit
    const saveEvidence = async (evidenceData) => {
        if (!dbAvailable) return null;
        try {
            const evidenceId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
            await db.collection('mission_evidence').doc(evidenceId).set({
                id: evidenceId,
                userEmail: storedUser.email,
                userName: storedUser.username,
                photo: evidenceData.photo || null,
                link: evidenceData.link || null,
                missionName: evidenceData.missionName || '',
                createdAt: new Date().toISOString(),
                serverTime: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('Evidência salva separadamente:', evidenceId);
            return evidenceId;
        } catch (e) {
            console.error('Erro ao salvar evidência:', e);
            return null;
        }
    };

    const saveAndSync = async () => {
        try {
            // Ensure points are synced as numbers
            storedUser.points = parseInt(userPoints) || 0;
            
            try {
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
            } catch(e) {
                console.warn("Could not save moura_leite_user locally (quota):", e);
            }
            
            // Update global list locally for immediate feedback
            try {
                const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
                const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
                if (userIndex !== -1) {
                    allUsers[userIndex].points = userPoints;
                    allUsers[userIndex].history = storedUser.history;
                    localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
                }
            } catch(e) {
                console.warn("Could not save moura_leite_all_users locally (quota):", e);
            }
            
            // Sync to Firestore if available
            if (dbAvailable && storedUser.email) {
                // CRITICAL FIX: Strip base64 photo data from history before sending to Firestore
                // Firestore has a 1MB document limit. Base64 photos can be 1-5MB each.
                // Without this, all writes fail silently after 1-2 photo uploads.
                const cleanUser = JSON.parse(JSON.stringify(storedUser));
                if (cleanUser.history && Array.isArray(cleanUser.history)) {
                    cleanUser.history = cleanUser.history.map(tx => {
                        const cleanTx = { ...tx };
                        if (cleanTx.photo && cleanTx.photo.startsWith('data:')) {
                            cleanTx.hasPhoto = true;
                            delete cleanTx.photo; // Remove base64 data
                        }
                        return cleanTx;
                    });
                }
                // Also strip notifications to reduce document size
                delete cleanUser.notifications;
                
                await db.collection('users').doc(storedUser.email).set(cleanUser, { merge: true });
                console.log('Sincronização com Firestore concluída.');
            }
        } catch (error) {
            console.error('Erro em saveAndSync:', error);
        }
    };

    const checkinBtns = document.querySelectorAll('#checkin-btn, #checkin-btn-full');
    const checkinStatus = document.getElementById('checkin-status');

    const updateCheckinUI = () => {
        if (storedUser.lastCheckIn === todayStr) {
            checkinBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
            if (checkinStatus) checkinStatus.textContent = 'Você já garantiu seu ponto de hoje!';
        }
    };

    checkinBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastCheckIn !== todayStr) {
                const multiplier = getCurrentMultiplier();
                const earned = Math.floor(1 * multiplier);
                userPoints += earned;
                storedUser.points = userPoints;
                storedUser.lastCheckIn = todayStr;
                // Keep custom mission key in sync
                storedUser['lastCustomDaily_sys_checkin'] = todayStr;
                
                // Add transaction to history
                const serverTimestamp = getServerTime();
                const transaction = {
                    user: storedUser.username,
                    item: `Missão: Check-in Diário (+${earned} ML Coins)`,
                    date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
                    time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído',
                    serverTime: serverTimestamp
                };

                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(transaction);

                try {
                    const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                    globalHistory.unshift(transaction);
                    if (globalHistory.length > 200) globalHistory.length = 200;
                    localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
                } catch(e) {}

                saveAndSync();
                updatePointsDisplay();
                updateRanking();
                updateUIWithUser();
                updateCheckinUI();
                // IMPORTANT: Fire confetti BEFORE alert, because alert() blocks the JS thread
                triggerCelebration();
                addNotification(`Check-in diário realizado! +${earned} ML Coins.`);
                setTimeout(() => {
                    alert(`Parabéns! Você ganhou ${earned} ML Coins pelo seu check-in diário.`);
                }, 300);
            }
        });
    });

    const triggerCelebration = () => {
        if (typeof confetti === 'function') {
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#006837', '#F1863B', '#1976d2', '#f57c00']
            });
        }
    };

    const logSocialActivity = (action, icon) => {
        if (!dbAvailable) return;
        try {
            db.collection('social_feed').add({
                user: storedUser.username,
                action: action,
                icon: icon || 'fa-star',
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error('Erro no social feed:', e);
        }
    };

    // Custom Missions Handler
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('custom-mission-btn')) {
            const missionId = e.target.getAttribute('data-mission-id');
            const missionName = e.target.getAttribute('data-mission-name');
            const missionPoints = parseInt(e.target.getAttribute('data-mission-points'));
            const validationType = e.target.getAttribute('data-validation-type');
            const frequency = e.target.getAttribute('data-frequency');

            // Get the last completion key based on frequency
            const lastKey = frequency === 'daily' ? 'lastCustomDaily_' + missionId
                          : frequency === 'weekly' ? 'lastCustomWeekly_' + missionId
                          : 'lastCustomMonthly_' + missionId;
            
            const dateKey = frequency === 'daily' ? todayStr
                         : frequency === 'weekly' ? currentWeek
                         : currentMonth;

            const isCompleted = storedUser[lastKey] === dateKey || 
                                (missionId === 'sys_checkin' && storedUser.lastCheckIn === todayStr) ||
                                (missionId === 'sys_lunch' && storedUser.lastLunchWeek === currentWeek) ||
                                (missionId === 'sys_reuniao' && storedUser.lastReuniaoWeek === currentWeek) ||
                                (missionId === 'sys_embaixador' && storedUser.lastLinkedInMonth === currentMonth) ||
                                (missionId === 'sys_vivaengage' && storedUser.lastVivaEngageMonth === currentMonth) ||
                                (missionId === 'sys_jogos' && storedUser.lastGamesWeek === currentWeek);

            if (isCompleted) {
                logMissionAttempt(storedUser.email, missionId, missionName, false, getServerTime());
                alert('Você já completou esta missão neste período.');
                return;
            }

            if (validationType === 'photo') {
                const photoInput = document.createElement('input');
                photoInput.type = 'file';
                photoInput.accept = 'image/*';
                photoInput.style.display = 'none'; // Importante para não aparecer na tela
                document.body.appendChild(photoInput); // Fix: iOS Safari exige que o input esteja no DOM para o click funcionar
                
                photoInput.onchange = () => {
                    const file = photoInput.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = () => {
                            completeMissionWithPhoto(missionId, missionName, missionPoints, reader.result, lastKey, dateKey);
                            if(document.body.contains(photoInput)) document.body.removeChild(photoInput);
                        };
                        reader.readAsDataURL(file);
                    } else {
                        if(document.body.contains(photoInput)) document.body.removeChild(photoInput);
                    }
                };
                photoInput.click();
            } else if (validationType === 'link') {
                const link = prompt(`Cole o link da ${missionName}:`);
                if (link && link.trim()) {
                    completeMissionWithLink(missionId, missionName, missionPoints, link, lastKey, dateKey);
                }
            } else {
                completeMissionSimple(missionId, missionName, missionPoints, lastKey, dateKey);
            }
        }
    });

    const completeMissionSimple = (missionId, missionName, missionPoints, lastKey, dateKey) => {
        const multiplier = getCurrentMultiplier();
        const earned = Math.floor(missionPoints * multiplier);
        const serverTimestamp = getServerTime();
        
        userPoints += earned;
        storedUser.points = userPoints;
        storedUser[lastKey] = dateKey;
        
        // Ensure system keys are updated if mission is a system mission
        if (missionId === 'sys_checkin') storedUser.lastCheckIn = todayStr;
        if (missionId === 'sys_lunch') {
            storedUser.lastLunchWeek = currentWeek;
            storedUser.lunchCount = (storedUser.lunchCount || 0) + 1;
        }
        if (missionId === 'sys_reuniao') {
            storedUser.lastReuniaoWeek = currentWeek;
            storedUser.reuniaoCount = (storedUser.reuniaoCount || 0) + 1;
        }
        if (missionId === 'sys_embaixador') {
            storedUser.lastLinkedInMonth = currentMonth;
            storedUser.linkedInCount = (storedUser.linkedInCount || 0) + 1;
        }
        if (missionId === 'sys_vivaengage') {
            storedUser.lastVivaEngageMonth = currentMonth;
            storedUser.vivaEngageCount = (storedUser.vivaEngageCount || 0) + 1;
        }
        if (missionId === 'sys_jogos') {
            storedUser.lastGamesWeek = currentWeek;
            storedUser.gamesCount = (storedUser.gamesCount || 0) + 1;
        }
        
        const transaction = {
            user: storedUser.username,
            item: `Missão: ${missionName} (+${earned} ML Coins)`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Concluído',
            serverTime: serverTimestamp
        };

        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift(transaction);
        
        // Global Sync is obsolete, handled by Firestore
        saveAndSync();
        
        // Log successful mission
        logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);
        
        updatePointsDisplay();
        updateRanking();
        updateUIWithUser();
        renderCustomMissions();
        // IMPORTANT: Fire confetti BEFORE alert, because alert() blocks the JS thread
        triggerCelebration();
        addNotification(`${missionName} concluída! +${earned} ML Coins.`);
        setTimeout(() => {
            alert(`Parabéns! Você ganhou ${earned} ML Coins por completar: ${missionName}`);
        }, 300);
    };

    const completeMissionWithPhoto = async (missionId, missionName, missionPoints, photoData, lastKey, dateKey) => {
        const multiplier = getCurrentMultiplier();
        const earned = Math.floor(missionPoints * multiplier);
        const serverTimestamp = getServerTime();

        try {
            userPoints += earned;
            storedUser.points = userPoints;
            storedUser[lastKey] = dateKey;
            storedUser.lastMissionTime = serverTimestamp;

            // Ensure system keys are updated if mission is a system mission
            if (missionId === 'sys_lunch') {
                storedUser.lastLunchWeek = currentWeek;
                storedUser.lunchCount = (storedUser.lunchCount || 0) + 1;
            }
            if (missionId === 'sys_reuniao') {
                storedUser.lastReuniaoWeek = currentWeek;
                storedUser.reuniaoCount = (storedUser.reuniaoCount || 0) + 1;
            }
            if (missionId === 'sys_jogos') {
                storedUser.lastGamesWeek = currentWeek;
                storedUser.gamesCount = (storedUser.gamesCount || 0) + 1;
            }

            // Save photo evidence to separate Firestore collection (avoids 1MB doc limit)
            const evidenceId = await saveEvidence({ photo: photoData, missionName: missionName });

            const transaction = {
                user: storedUser.username,
                item: `Missão: ${missionName} (+${earned} ML Coins)`,
                date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
                time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                status: 'Validando',
                photo: '[EVIDENCIA_SALVA]',
                evidenceId: evidenceId || null,
                hasPhoto: true,
                serverTime: serverTimestamp
            };

            if (!storedUser.history) storedUser.history = [];
            storedUser.history.unshift(transaction);

            // CRITICAL: Clean any legacy base64 photos from history before saving to localStorage.
            // Old entries (before the fix) may still contain raw base64 strings, causing a silent
            // QuotaExceededError that aborts the entire function: no points, no history, no alert.
            storedUser.history = storedUser.history.map(tx => {
                if (tx.photo && typeof tx.photo === 'string' && tx.photo.startsWith('data:')) {
                    return { ...tx, photo: '[EVIDENCIA_SALVA]', hasPhoto: true };
                }
                return tx;
            });

            try {
                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(transaction);
                if (globalHistory.length > 200) globalHistory.length = 200;
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
            } catch (storageErr) {
                // localStorage quota exceeded — not fatal. Firestore sync below will persist data.
                console.warn('localStorage cheio, usando apenas Firestore:', storageErr);
            }

            // Always sync to Firestore regardless of localStorage outcome
            saveAndSync();

            // Log successful mission
            logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);

            updatePointsDisplay();
            updateRanking();
            updateUIWithUser();
            renderCustomMissions();

            // Fire confetti BEFORE alert (alert blocks the JS render thread)
            triggerCelebration();
            addNotification(`${missionName} enviada para validação! +${earned} ML Coins.`);
            setTimeout(() => {
                alert(`Foto enviada! Você ganhou ${earned} ML Coins por: ${missionName}`);
            }, 300);

        } catch (fatalErr) {
            // Rollback points to prevent phantom points with no matching history entry
            userPoints -= earned;
            storedUser.points = userPoints;
            storedUser[lastKey] = null;
            console.error('ERRO CRÍTICO em completeMissionWithPhoto:', fatalErr);
            alert('Ocorreu um erro ao registrar sua missão. Tente novamente. Se o problema persistir, avise o administrador.');
        }
    };

    const completeMissionWithLink = (missionId, missionName, missionPoints, link, lastKey, dateKey) => {
        const multiplier = getCurrentMultiplier();
        const earned = Math.floor(missionPoints * multiplier);
        const serverTimestamp = getServerTime();
        
        userPoints += earned;
        storedUser.points = userPoints;
        storedUser[lastKey] = dateKey;
        storedUser.lastMissionTime = serverTimestamp;

        // Ensure system keys are updated if mission is a system mission
        if (missionId === 'sys_embaixador') {
            storedUser.lastLinkedInMonth = currentMonth;
            storedUser.linkedInCount = (storedUser.linkedInCount || 0) + 1;
        }
        if (missionId === 'sys_vivaengage') {
            storedUser.lastVivaEngageMonth = currentMonth;
            storedUser.vivaEngageCount = (storedUser.vivaEngageCount || 0) + 1;
        }
        
        const transaction = {
            user: storedUser.username,
            item: `Missão: ${missionName} (+${earned} ML Coins)`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Validando',
            link: link,
            serverTime: serverTimestamp
        };

        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift(transaction);
        
        // Global Sync
        try {
            const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
            globalHistory.unshift(transaction);
            if (globalHistory.length > 200) globalHistory.length = 200;
            localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
            
            localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        } catch(e) {}
        saveAndSync();
        
        // Sync with global list (redundant if saveAndSync works but kept for safety)
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
        if (userIndex !== -1) {
            allUsers[userIndex].points = userPoints;
            allUsers[userIndex].history = storedUser.history;
            try {
                localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
            } catch(e) {}
        }
        
        // Log successful mission
        logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);
        
        updatePointsDisplay();
        updateRanking();
        updateUIWithUser();
        renderCustomMissions();
        // IMPORTANT: Fire confetti BEFORE alert, because alert() blocks the JS thread
        triggerCelebration();
        addNotification(`${missionName} enviada para validação! +${earned} ML Coins.`);
        setTimeout(() => {
            alert(`Link enviado! Você ganhou ${earned} ML Coins por: ${missionName}`);
        }, 300);
    };

    window.viewPhoto = async (photoData, evidenceId = null) => {
        // Create viewer modal
        const viewer = document.createElement('div');
        viewer.id = 'photo-viewer-modal';
        viewer.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:10000; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer;';
        
        const img = document.createElement('img');
        img.style = 'max-width:95%; max-height:85%; border-radius:12px; border: 4px solid white; box-shadow: 0 0 30px rgba(0,0,0,0.5); object-fit: contain;';
        
        const closeBtn = document.createElement('div');
        closeBtn.innerHTML = '&times;';
        closeBtn.style = 'position:absolute; top:20px; right:30px; color:white; font-size:40px; font-weight:bold; cursor:pointer;';
        
        const tip = document.createElement('p');
        tip.textContent = 'Carregando foto...';
        tip.style = 'color:#aaa; margin-top:15px; font-size:14px;';

        viewer.appendChild(closeBtn);
        viewer.appendChild(img);
        viewer.appendChild(tip);
        
        viewer.onclick = () => viewer.remove();
        document.body.appendChild(viewer);

        let finalSrc = photoData;

        // Fetch from Firestore if evidenceId is present
        if (evidenceId && dbAvailable) {
            try {
                const doc = await db.collection('mission_evidence').doc(evidenceId).get();
                if (doc.exists && doc.data().photo) {
                    finalSrc = doc.data().photo;
                } else {
                    tip.textContent = 'Erro: Foto não encontrada no servidor.';
                    return;
                }
            } catch (err) {
                console.error('Erro ao carregar evidência:', err);
                tip.textContent = 'Erro ao carregar foto do servidor.';
                return;
            }
        } else if (photoData === '[EVIDENCIA_SALVA]') {
            tip.textContent = 'Erro: ID da evidência não encontrado.';
            return;
        }

        img.src = finalSrc;
        tip.textContent = 'Clique em qualquer lugar para fechar';
    };

    const startCountdown = () => {
        setInterval(() => {
            const badges = document.querySelectorAll('.quest-hot-badge');
            badges.forEach(badge => {
                const expiresAt = parseInt(badge.getAttribute('data-expires'));
                const diff = expiresAt - Date.now();
                
                if (diff <= 0) {
                    badge.innerHTML = '<span>Expirada</span>';
                    badge.style.background = '#ccc';
                    badge.style.border = '1px solid #999';
                    
                    // Disable the corresponding mission button
                    const card = badge.closest('.quest-card');
                    if (card) {
                        const btn = card.querySelector('.custom-mission-btn');
                        if (btn && !btn.disabled) {
                            btn.disabled = true;
                            btn.innerText = 'Expirada';
                            btn.style.background = '#e0e0e0';
                            btn.style.color = '#999';
                        }
                    }
                    return;
                }

                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                
                let timeStr = "";
                if (hours > 0) timeStr += `${hours}h `;
                if (minutes > 0 || hours > 0) timeStr += `${minutes}m `;
                timeStr += `${seconds}s`;
                
                const span = badge.querySelector('span');
                if (span) span.innerText = timeStr;
            });
        }, 1000);
    };

    updateCheckinUI();
    updatePointsDisplay();
    updateRanking();
    updateUIWithUser();
    startCountdown();
    
    // Custom Missions & Prizes Initialization
    seedDefaultMissions();
    seedDefaultPrizes();
    subscribeSharedMissions();
    registerMissionFormListener();
    subscribeSharedPrizes();
    registerPrizeFormListener();
});
