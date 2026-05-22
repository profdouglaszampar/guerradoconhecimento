/* ==========================================================
   GUERRA DO CONHECIMENTO - Main Game Logic
   ========================================================== */

// ========== CONSTANTS ==========
const TEAM_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#7209b7'];
const TEAM_COLORS_LIGHT = ['#ff6b6b', '#6baed6', '#52d6c8', '#ffbf80', '#a855f7'];
const TEAM_COLORS_DARK = ['#9b1b24', '#2d5068', '#1b6b60', '#c47a30', '#4a0675'];
const NEUTRAL_COLOR = '#3a3a5a';

const TERRITORY_NAMES = [
    'Forte do Norte', 'Planície dos Ventos', 'Vale Sombrio', 'Montanha do Trovão',
    'Floresta Encantada', 'Porto do Oeste', 'Deserto Vermelho', 'Lago Cristalino',
    'Ruínas Antigas', 'Colinas Verdes', 'Passo da Águia', 'Rio Selvagem',
    'Torre de Pedra', 'Campo Dourado', 'Baía dos Piratas', 'Serra Negra',
    'Ilha do Dragão', 'Muralha de Gelo', 'Pântano Sombrio', 'Vulcão Adormecido',
    'Oásis Secreto', 'Caverna dos Ecos', 'Farol do Sul', 'Templo Perdido',
    'Ponte dos Reis', 'Cidadela do Leste', 'Jardim de Pedra', 'Costa Brava',
    'Portal Místico', 'Trono do Rei'
];

// Hex map layout - offset coordinates [row, col]
const MAP_LAYOUT = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
    [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
    [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5],
    [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
    [5, 1], [5, 2], [5, 3], [5, 4],
    [6, 2], [6, 3]
];

const HEX_SIZE = 48;
const DEFAULT_TIME = 45;
const FEEDBACK_DURATION = 2500;

// Dice weights: face → weight (higher weight = more likely)
// 6(1), 5(1), 4(2), 3(3), 2(3), 1(2)
const DICE_WEIGHTS = [
    { face: 1, weight: 2 },
    { face: 2, weight: 3 },
    { face: 3, weight: 3 },
    { face: 4, weight: 2 },
    { face: 5, weight: 1 },
    { face: 6, weight: 1 },
];
const DICE_TOTAL_WEIGHT = DICE_WEIGHTS.reduce((s, d) => s + d.weight, 0);
const AVAILABLE_THEMES = ['empire', 'cyber', 'wild'];

// ========== GAME STATE ==========
let state = {
    questions: [],
    teams: [],
    territories: [],
    turnOrder: [],
    currentOrderPos: 0,
    currentTeamIndex: 0,
    currentPlayerIndices: [],
    round: 1,
    usedQuestions: new Set(),
    timerInterval: null,
    timeRemaining: 0,
    gameStarted: false,
    gameEnded: false,
    questionCount: 0,
    // Dice & selection
    diceResult: 0,
    selectionMode: false,
    territoriesToClaim: 0,
    claimedThisTurn: [],
    draftPhase: false,
    draftPickCounts: [],
    secretCode: '123',
    selectedTheme: 'empire',
};

// ========== FILE PARSER ==========
function parseQuestionsFile(text) {
    const lines = text.split(/\r?\n/);
    const questions = [];
    let currentWeight = 1;
    let inQuestionSection = false;

    for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed) continue;

        // Start parsing only after the first line containing "Peso X"
        const pesoMatch = trimmed.match(/\bPeso\s+(\d+)\b/i);
        if (pesoMatch) {
            currentWeight = parseInt(pesoMatch[1]);
            inQuestionSection = true;
            continue;
        }

        if (!inQuestionSection) continue;

        // Extra time only when "(+Xs)" appears at the beginning of the line
        let extraTime = 0;
        const timeMatch = trimmed.match(/^\(\+(\d+)s\)\s*/i);
        if (timeMatch) {
            extraTime = parseInt(timeMatch[1]);
            trimmed = trimmed.slice(timeMatch[0].length).trim();
        }

        const semiIndex = trimmed.indexOf(';');
        if (semiIndex === -1) continue;

        const questionText = trimmed.substring(0, semiIndex).trim();
        const answersText = trimmed.substring(semiIndex + 1).trim();
        if (!questionText || !answersText) continue;

        const answers = answersText.split(',').map(a => a.trim()).filter(a => a.length > 0);
        if (answers.length === 0) continue;

        questions.push({
            text: questionText,
            answers: answers,
            weight: currentWeight,
            timeLimit: DEFAULT_TIME + extraTime,
        });
    }
    return questions;
}

function escapeHTML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatQuestionHTML(text) {
    let html = escapeHTML(text || '');

    // Keep explicit line breaks from source questions
    html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

    // Accept either <b>...</b> or paired <b> markers by toggling on each marker
    html = html.replace(/&lt;\/b&gt;/gi, '&lt;b&gt;');
    let openTag = true;
    html = html.replace(/&lt;b&gt;/gi, () => {
        if (openTag) { openTag = false; return '<strong>'; }
        else { openTag = true; return '</strong>'; }
    });

    // Render 3+ underscores as a visible "fill in the blank" gap
    html = html.replace(/_{3,}/g, (match) => {
        return `<span class="question-gap" style="--gap-ch:${match.length};"></span>`;
    });

    return html;
}

function shuffleArray(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function applyTheme(themeId) {
    const theme = AVAILABLE_THEMES.includes(themeId) ? themeId : 'empire';
    state.selectedTheme = theme;

    AVAILABLE_THEMES.forEach((id) => {
        document.body.classList.remove(`theme-${id}`);
    });
    document.body.classList.add(`theme-${theme}`);

    document.querySelectorAll('.theme-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

function initThemeSelector() {
    const options = document.querySelectorAll('.theme-option');
    options.forEach((btn) => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });
    applyTheme(state.selectedTheme);
}

// ========== HEX MAP UTILITIES ==========
function hexCenter(row, col) {
    const w = Math.sqrt(3) * HEX_SIZE;
    const h = 2 * HEX_SIZE;
    const x = col * w + (row % 2 === 1 ? w / 2 : 0) + 80;
    const y = row * (h * 0.75) + 80;
    return { x, y };
}

function hexPoints(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        pts.push(`${cx + HEX_SIZE * Math.cos(angle)},${cy + HEX_SIZE * Math.sin(angle)}`);
    }
    return pts.join(' ');
}

function getNeighbors(row, col) {
    const neighbors = [];
    const evenOffsets = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
    const oddOffsets  = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
    const offsets = row % 2 === 0 ? evenOffsets : oddOffsets;
    for (const [dr, dc] of offsets) {
        const idx = MAP_LAYOUT.findIndex(([r, c]) => r === row + dr && c === col + dc);
        if (idx !== -1) neighbors.push(idx);
    }
    return neighbors;
}

function getAttackableTerritories(teamIndex) {
    const ownedIndices = new Set(
        state.territories.map((t, i) => t.owner === teamIndex ? i : -1).filter(i => i >= 0)
    );
    const attackable = new Set();
    for (const idx of ownedIndices) {
        const [row, col] = MAP_LAYOUT[idx];
        for (const nIdx of getNeighbors(row, col)) {
            if (!ownedIndices.has(nIdx)) attackable.add(nIdx);
        }
    }
    return [...attackable];
}

// Recalculate attackable considering already-claimed territories this turn
function getSelectableTerritories(teamIndex) {
    const ownedIndices = new Set(
        state.territories.map((t, i) => t.owner === teamIndex ? i : -1).filter(i => i >= 0)
    );
    // Also include territories claimed this turn (they are already set as owned)
    const attackable = new Set();
    for (const idx of ownedIndices) {
        const [row, col] = MAP_LAYOUT[idx];
        for (const nIdx of getNeighbors(row, col)) {
            if (!ownedIndices.has(nIdx)) attackable.add(nIdx);
        }
    }
    return [...attackable];
}

// ========== DICE ==========
function rollDiceWeighted() {
    let rand = Math.random() * DICE_TOTAL_WEIGHT;
    for (const d of DICE_WEIGHTS) {
        rand -= d.weight;
        if (rand <= 0) return d.face;
    }
    return DICE_WEIGHTS[DICE_WEIGHTS.length - 1].face;
}

function showDiceRoll(callback) {
    const overlay = document.getElementById('dice-overlay');
    const face = document.getElementById('dice-face');
    const resultText = document.getElementById('dice-result-text');
    const continueBtn = document.getElementById('dice-continue-btn');
    const teamLabel = document.getElementById('dice-team-label');

    const team = state.teams[state.currentTeamIndex];
    const playerIdx = state.currentPlayerIndices[state.currentTeamIndex];
    const player = team.players[playerIdx % team.players.length];
    teamLabel.innerHTML = `<span style="color:${team.color}">${team.name}</span> — ${player}`;

    // Reset
    face.textContent = '?';
    face.className = 'dice-face';
    resultText.textContent = 'Rolando o dado...';
    continueBtn.classList.add('hidden');
    overlay.classList.remove('hidden');

    // Rolling animation: cycle random numbers
    face.classList.add('rolling');
    let rollCount = 0;
    const rollInterval = setInterval(() => {
        face.textContent = Math.floor(Math.random() * 6) + 1;
        rollCount++;
    }, 80);

    // Stop after ~1.5s
    setTimeout(() => {
        clearInterval(rollInterval);
        const result = rollDiceWeighted();
        state.diceResult = result;
        state.territoriesToClaim = result;

        face.classList.remove('rolling');
        face.classList.add('landed');
        face.textContent = result;

        const plural = result === 1 ? 'território' : 'territórios';
        resultText.textContent = `${result} ${plural}!`;
        continueBtn.classList.remove('hidden');

        // Continue button handler
        const handleContinue = () => {
            continueBtn.removeEventListener('click', handleContinue);
            overlay.classList.add('hidden');
            callback(result);
        };
        continueBtn.addEventListener('click', handleContinue);
    }, 1500);
}

// ========== SETUP SCREEN ==========
function initSetupScreen() {
    const fileUploadArea = document.getElementById('file-upload-area');
    const fileInput = document.getElementById('file-input');

    fileUploadArea.addEventListener('click', () => fileInput.click());
    fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUploadArea.classList.add('dragover');
    });
    fileUploadArea.addEventListener('dragleave', () => fileUploadArea.classList.remove('dragover'));
    fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
    });

    document.querySelectorAll('.team-count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.team-count-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTeamCards(parseInt(btn.dataset.count));
            validateSetup();
        });
    });

    document.getElementById('start-btn').addEventListener('click', startGame);
    initThemeSelector();
    renderTeamCards(4);
}

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        state.questions = parseQuestionsFile(e.target.result);
        const fileInfo = document.getElementById('file-info');
        const fileInfoText = document.getElementById('file-info-text');
        if (state.questions.length > 0) {
            fileInfo.classList.remove('hidden');
            fileInfo.style.background = 'rgba(34, 197, 94, 0.15)';
            fileInfo.style.borderColor = 'rgba(34, 197, 94, 0.3)';
            fileInfoText.style.color = '';
            const weights = [...new Set(state.questions.map(q => q.weight))].sort();
            fileInfoText.textContent = `✓ ${state.questions.length} perguntas carregadas (Pesos: ${weights.join(', ')})`;
        } else {
            fileInfo.classList.remove('hidden');
            fileInfo.style.background = 'rgba(239, 68, 68, 0.15)';
            fileInfo.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            fileInfoText.textContent = '✗ Nenhuma pergunta encontrada. Verifique o formato do arquivo.';
            fileInfoText.style.color = '#ef4444';
        }
        validateSetup();
    };
    reader.readAsText(file, 'UTF-8');
}

function renderTeamCards(count) {
    const container = document.getElementById('teams-config');
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.style.borderColor = TEAM_COLORS[i] + '40';
        card.innerHTML = `
            <div class="team-card-header">
                <div class="team-color-dot" style="background:${TEAM_COLORS[i]};color:${TEAM_COLORS[i]}"></div>
                <input type="text" class="team-name-input" placeholder="Nome do Time ${i + 1}" data-team="${i}" maxlength="20">
            </div>
            <div class="players-list" data-team="${i}">
                <div class="player-input-row"><input type="text" class="player-input" placeholder="Jogador 1" data-team="${i}" maxlength="20"></div>
                <div class="player-input-row"><input type="text" class="player-input" placeholder="Jogador 2" data-team="${i}" maxlength="20"></div>
            </div>
            <button class="add-player-btn" data-team="${i}">+ Adicionar jogador</button>
        `;
        container.appendChild(card);
    }
    container.querySelectorAll('.add-player-btn').forEach(btn => {
        btn.addEventListener('click', () => addPlayer(parseInt(btn.dataset.team)));
    });
    container.addEventListener('input', validateSetup);
}

function addPlayer(teamIndex) {
    const playersList = document.querySelector(`.players-list[data-team="${teamIndex}"]`);
    const currentCount = playersList.querySelectorAll('.player-input-row').length;
    if (currentCount >= 8) return;
    const row = document.createElement('div');
    row.className = 'player-input-row';
    row.innerHTML = `
        <input type="text" class="player-input" placeholder="Jogador ${currentCount + 1}" data-team="${teamIndex}" maxlength="20">
        <button class="remove-player-btn" title="Remover">✕</button>
    `;
    row.querySelector('.remove-player-btn').addEventListener('click', () => {
        row.remove();
        updateAddButton(teamIndex);
        validateSetup();
    });
    playersList.appendChild(row);
    updateAddButton(teamIndex);
    row.querySelector('input').focus();
}

function updateAddButton(teamIndex) {
    const playersList = document.querySelector(`.players-list[data-team="${teamIndex}"]`);
    const addBtn = document.querySelector(`.add-player-btn[data-team="${teamIndex}"]`);
    const count = playersList.querySelectorAll('.player-input-row').length;
    addBtn.classList.toggle('disabled', count >= 8);
    addBtn.textContent = count >= 8 ? 'Máximo de jogadores' : '+ Adicionar jogador';
}

function validateSetup() {
    const startBtn = document.getElementById('start-btn');
    const hasQuestions = state.questions.length > 0;
    const teamCount = parseInt(document.querySelector('.team-count-btn.active')?.dataset.count || 4);
    let teamsValid = true;
    for (let i = 0; i < teamCount; i++) {
        const nameInput = document.querySelector(`.team-name-input[data-team="${i}"]`);
        const playerInputs = document.querySelectorAll(`.player-input[data-team="${i}"]`);
        if (!nameInput || !nameInput.value.trim()) { teamsValid = false; break; }
        if ([...playerInputs].filter(p => p.value.trim()).length < 1) { teamsValid = false; break; }
    }
    startBtn.disabled = !(hasQuestions && teamsValid);
}

// ========== GAME INITIALIZATION ==========
function startGame() {
    const teamCount = parseInt(document.querySelector('.team-count-btn.active').dataset.count);
    state.teams = [];
    for (let i = 0; i < teamCount; i++) {
        const name = document.querySelector(`.team-name-input[data-team="${i}"]`).value.trim();
        const playerInputs = document.querySelectorAll(`.player-input[data-team="${i}"]`);
        const players = [...playerInputs].map(p => p.value.trim()).filter(p => p.length > 0);
        state.teams.push({ name, players, color: TEAM_COLORS[i], colorLight: TEAM_COLORS_LIGHT[i] });
    }

    initTerritories();
    state.turnOrder = shuffleArray([...state.teams.keys()]);
    state.currentOrderPos = 0;
    state.currentTeamIndex = state.turnOrder[state.currentOrderPos];
    state.currentPlayerIndices = new Array(state.teams.length).fill(0);
    state.round = 1;
    state.usedQuestions = new Set();
    state.gameStarted = true;
    state.gameEnded = false;
    state.questionCount = 0;
    state.selectionMode = true;
    state.draftPhase = true;
    state.draftPickCounts = new Array(state.teams.length).fill(0);

    enterFullscreen();
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    renderMap('hex-map');
    renderSidebar();
    enterDraftPhase();
}

function initTerritories() {
    state.territories = MAP_LAYOUT.map(([r, c], i) => ({
        row: r, col: c,
        name: TERRITORY_NAMES[i] || `Território ${i + 1}`,
        owner: -1
    }));
}

// ========== MAP RENDERING ==========
function renderMap(svgId) {
    const svg = document.getElementById(svgId);
    svg.innerHTML = '';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [r, c] of MAP_LAYOUT) {
        const { x, y } = hexCenter(r, c);
        minX = Math.min(minX, x - HEX_SIZE);
        minY = Math.min(minY, y - HEX_SIZE);
        maxX = Math.max(maxX, x + HEX_SIZE);
        maxY = Math.max(maxY, y + HEX_SIZE);
    }
    svg.setAttribute('viewBox', `${minX - 10} ${minY - 10} ${maxX - minX + 20} ${maxY - minY + 20}`);
    renderMapPaths(svg);

    for (let i = 0; i < MAP_LAYOUT.length; i++) {
        const [r, c] = MAP_LAYOUT[i];
        const { x, y } = hexCenter(r, c);
        const territory = state.territories[i];
        const fillColor = territory.owner >= 0 ? state.teams[territory.owner].color : NEUTRAL_COLOR;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'hex-territory');
        group.setAttribute('data-index', i);

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', hexPoints(x, y));
        polygon.setAttribute('fill', fillColor);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y - 5);
        text.textContent = (i + 1).toString();

        const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nameText.setAttribute('x', x);
        nameText.setAttribute('y', y + 10);
        nameText.setAttribute('class', 'hex-name');
        nameText.textContent = territory.name.length > 12
            ? territory.name.substring(0, 11) + '…' : territory.name;

        group.appendChild(polygon);
        group.appendChild(text);
        group.appendChild(nameText);

        // Click handler for territory selection
        group.addEventListener('click', () => onTerritoryClick(i));

        svg.appendChild(group);
    }
    if (svgId === 'hex-map') renderLegend();
}

function renderMapPaths(svg) {
    const pathsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pathsGroup.setAttribute('class', 'map-paths');
    svg.appendChild(pathsGroup);

    const uniqueEdges = new Set();
    for (let i = 0; i < MAP_LAYOUT.length; i++) {
        const [row, col] = MAP_LAYOUT[i];
        const from = hexCenter(row, col);
        const neighbors = getNeighbors(row, col).filter(n => n > i);

        for (const n of neighbors) {
            const key = `${i}-${n}`;
            if (uniqueEdges.has(key)) continue;
            uniqueEdges.add(key);

            const [nr, nc] = MAP_LAYOUT[n];
            const to = hexCenter(nr, nc);

            // Slight deterministic bend to avoid perfectly symmetric visual lines.
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            const offsetSeed = ((i * 17 + n * 11) % 7) - 3;
            const dx = offsetSeed * 3.2;
            const dy = -offsetSeed * 2.6;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'map-path');
            path.setAttribute('d', `M ${from.x} ${from.y} Q ${midX + dx} ${midY + dy} ${to.x} ${to.y}`);
            pathsGroup.appendChild(path);
        }
    }
}

function updateMapColors() {
    document.querySelectorAll('#hex-map .hex-territory').forEach(hex => {
        const idx = parseInt(hex.dataset.index);
        const territory = state.territories[idx];
        const fillColor = territory.owner >= 0 ? state.teams[territory.owner].color : NEUTRAL_COLOR;
        hex.querySelector('polygon').setAttribute('fill', fillColor);
    });
}

function highlightAttackable(territories) {
    document.querySelectorAll('#hex-map .hex-territory').forEach(h => {
        h.classList.remove('attackable', 'selected', 'selectable', 'just-claimed');
    });
    territories.forEach(idx => {
        const hex = document.querySelector(`#hex-map .hex-territory[data-index="${idx}"]`);
        if (hex) hex.classList.add('attackable');
    });
}

function highlightSelectable(territories) {
    document.querySelectorAll('#hex-map .hex-territory').forEach(h => {
        h.classList.remove('attackable', 'selectable');
    });
    territories.forEach(idx => {
        const hex = document.querySelector(`#hex-map .hex-territory[data-index="${idx}"]`);
        if (hex) hex.classList.add('selectable');
    });
}

function clearHighlights() {
    document.querySelectorAll('#hex-map .hex-territory').forEach(h => {
        h.classList.remove('attackable', 'selected', 'selectable', 'just-claimed');
    });
}

function renderLegend() {
    const legend = document.getElementById('map-legend');
    legend.innerHTML = '';
    state.teams.forEach((team, i) => {
        const count = state.territories.filter(t => t.owner === i).length;
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<div class="legend-color" style="background:${team.color}"></div><span>${team.name}: ${count}</span>`;
        legend.appendChild(item);
    });
    const neutralCount = state.territories.filter(t => t.owner === -1).length;
    if (neutralCount > 0) {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<div class="legend-color" style="background:${NEUTRAL_COLOR}"></div><span>Neutro: ${neutralCount}</span>`;
        legend.appendChild(item);
    }
}

// ========== SIDEBAR ==========
function renderSidebar() {
    updateScoreboard();
    updateTurnInfo();
    updateQuestionsRemaining();
}

function updateScoreboard() {
    const scoreboard = document.getElementById('scoreboard');
    scoreboard.innerHTML = '';
    const teamScores = state.teams.map((team, i) => ({
        index: i, name: team.name, color: team.color,
        territories: state.territories.filter(t => t.owner === i).length
    }));
    teamScores.sort((a, b) => b.territories - a.territories);
    teamScores.forEach(team => {
        const item = document.createElement('div');
        item.className = 'score-item' + (team.index === state.currentTeamIndex ? ' active-turn' : '');
        item.innerHTML = `
            <div class="score-color" style="background:${team.color}"></div>
            <span class="score-name">${team.name}</span>
            <span class="score-territories">${team.territories}</span>
        `;
        scoreboard.appendChild(item);
    });
    renderLegend();
}

function updateTurnInfo() {
    const team = state.teams[state.currentTeamIndex];
    const playerIdx = state.currentPlayerIndices[state.currentTeamIndex];
    const player = team.players[playerIdx % team.players.length];

    document.getElementById('current-team-name').textContent = team.name;
    document.getElementById('current-team-name').style.color = team.color;
    if (state.draftPhase) {
        const chosen = state.draftPickCounts[state.currentTeamIndex] || 0;
        document.getElementById('current-player-name').textContent = `Escolha inicial (${chosen}/3)`;
        document.getElementById('round-info').textContent = 'Escolha Inicial';
        highlightSelectable(getNeutralTerritories());
    } else {
        document.getElementById('current-player-name').textContent = player;
        document.getElementById('round-info').textContent = `Rodada ${state.round}`;

        // Show attackable preview (non-interactive)
        const attackable = getAttackableTerritories(state.currentTeamIndex);
        highlightAttackable(attackable);
    }
}

function updateQuestionsRemaining() {
    const remaining = state.questions.length - state.usedQuestions.size;
    document.getElementById('questions-remaining-text').textContent = `Perguntas restantes: ${remaining}`;
}

// ========== QUESTION SELECTION ==========
function selectQuestion() {
    let available = state.questions
        .map((q, i) => ({ ...q, originalIndex: i }))
        .filter((q, i) => !state.usedQuestions.has(i));
    if (available.length === 0) {
        state.usedQuestions.clear();
        available = state.questions.map((q, i) => ({ ...q, originalIndex: i }));
    }
    if (available.length === 0) return null;

    const totalWeight = available.reduce((sum, q) => sum + q.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const q of available) {
        rand -= q.weight;
        if (rand <= 0) { state.usedQuestions.add(q.originalIndex); return q; }
    }
    const last = available[available.length - 1];
    state.usedQuestions.add(last.originalIndex);
    return last;
}

// ========== ANSWER CHECKING ==========
function checkAnswer(userAnswer, correctAnswers) {
    const normalizedUser = userAnswer.trim().toLowerCase();
    return correctAnswers.some(a => a.trim().toLowerCase() === normalizedUser);
}

// ========== GAME FLOW ==========
// New flow: ATACAR → Dice Roll → Question → Territory Selection (if correct)

function initAttackButton() {
    document.getElementById('attack-btn').addEventListener('click', onAttack);
    document.getElementById('selection-confirm-btn').addEventListener('click', onConfirmSelection);
}

function onAttack() {
    if (state.gameEnded || state.selectionMode || state.draftPhase) return;

    const attackable = getAttackableTerritories(state.currentTeamIndex);
    if (attackable.length === 0) {
        if (checkDomination()) {
            endGame();
            return;
        }
        nextTurn();
        return;
    }

    const question = selectQuestion();
    if (!question) {
        nextTurn();
        return;
    }

    state.questionCount++;

    // Step 1: Roll the dice
    showDiceRoll((diceResult) => {
        // Step 2: Show the question
        showQuestion(question, diceResult);
    });
}

function showQuestion(question, diceResult) {
    const modal = document.getElementById('question-modal');
    const team = state.teams[state.currentTeamIndex];
    const playerIdx = state.currentPlayerIndices[state.currentTeamIndex];
    const player = team.players[playerIdx % team.players.length];

    document.getElementById('modal-team-name').textContent = team.name;
    document.getElementById('modal-team-name').style.color = team.color;
    document.getElementById('modal-player-name').textContent = player;
    document.getElementById('modal-header').style.background =
        `linear-gradient(135deg, ${team.color}20, ${team.color}05)`;

    // Dice info in header
    const plural = diceResult === 1 ? 'território' : 'territórios';
    document.getElementById('modal-dice-info').textContent = `🎲 ${diceResult} ${plural}`;
    document.getElementById('modal-territory-info').textContent = '';

    document.getElementById('question-weight').textContent =
        question.weight > 1 ? `★ Peso ${question.weight}` : '';
    document.getElementById('question-text').innerHTML = formatQuestionHTML(question.text);

    const answerInput = document.getElementById('answer-input');
    answerInput.value = '';

    modal.classList.remove('hidden');
    setTimeout(() => answerInput.focus(), 300);

    startTimer(question.timeLimit, question);

    const submitBtn = document.getElementById('submit-answer-btn');
    const handleSubmit = () => {
        submitBtn.removeEventListener('click', handleSubmit);
        answerInput.removeEventListener('keydown', handleKeydown);
        processAnswer(answerInput.value, question);
    };
    const handleKeydown = (e) => { if (e.key === 'Enter') handleSubmit(); };

    submitBtn.addEventListener('click', handleSubmit);
    answerInput.addEventListener('keydown', handleKeydown);
    modal._handleSubmit = handleSubmit;
    modal._handleKeydown = handleKeydown;
}

function startTimer(seconds, question) {
    state.timeRemaining = seconds;
    const totalTime = seconds;
    const timerBar = document.getElementById('timer-bar');
    const timerText = document.getElementById('timer-text');

    timerBar.style.width = '100%';
    timerBar.className = 'timer-bar';
    timerText.textContent = `${seconds}s`;

    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
        state.timeRemaining -= 0.1;
        const pct = (state.timeRemaining / totalTime) * 100;
        timerBar.style.width = `${Math.max(0, pct)}%`;
        timerText.textContent = `${Math.ceil(Math.max(0, state.timeRemaining))}s`;

        if (pct < 20) timerBar.className = 'timer-bar danger';
        else if (pct < 50) timerBar.className = 'timer-bar warning';

        if (state.timeRemaining <= 0) {
            clearInterval(state.timerInterval);
            timeUp(question);
        }
    }, 100);
}

function timeUp(question) {
    const modal = document.getElementById('question-modal');
    const submitBtn = document.getElementById('submit-answer-btn');
    const answerInput = document.getElementById('answer-input');
    const userAnswer = answerInput.value;
    if (modal._handleSubmit) submitBtn.removeEventListener('click', modal._handleSubmit);
    if (modal._handleKeydown) answerInput.removeEventListener('keydown', modal._handleKeydown);
    hideQuestion();

    state._lastQuestion = question.text;
    state._lastUserAnswer = userAnswer;
    state._lastCorrectAnswers = question.answers;

    showReviewScreen('timeout', question.text, userAnswer, question.answers);
}

function processAnswer(userAnswer, question) {
    clearInterval(state.timerInterval);
    hideQuestion();

    // Store for review after territory selection
    state._lastQuestion = question.text;
    state._lastUserAnswer = userAnswer;
    state._lastCorrectAnswers = question.answers;

    const correct = checkAnswer(userAnswer, question.answers);
    if (correct) {
        showAccertouSplash();
    } else {
        showReviewScreen('wrong', question.text, userAnswer, question.answers);
    }
}

function hideQuestion() {
    document.getElementById('question-modal').classList.add('hidden');
}

// Quick splash for correct answers (auto-dismiss, then territory selection)
function showAccertouSplash() {
    const overlay = document.getElementById('feedback-overlay');
    const content = document.getElementById('feedback-content');
    const icon = document.getElementById('feedback-icon');
    const text = document.getElementById('feedback-text');
    const unlockSection = overlay.querySelector('.feedback-unlock');
    const detailsSection = overlay.querySelector('.feedback-details');

    content.className = 'feedback-content feedback-correct';
    icon.textContent = '⚔️';
    const plural = state.diceResult === 1 ? 'território' : 'territórios';
    text.textContent = `ACERTOU! Escolha ${state.diceResult} ${plural}!`;

    // Hide details and unlock for the splash
    detailsSection.style.display = 'none';
    unlockSection.style.display = 'none';

    overlay.classList.remove('hidden');

    setTimeout(() => {
        overlay.classList.add('hidden');
        // Restore visibility for future use
        detailsSection.style.display = '';
        unlockSection.style.display = '';
        enterSelectionMode();
    }, FEEDBACK_DURATION);
}

// Review screen with question, answer, gabarito, and 123 unlock
function showReviewScreen(type, questionText, userAnswer, correctAnswers) {
    const overlay = document.getElementById('feedback-overlay');
    const content = document.getElementById('feedback-content');
    const icon = document.getElementById('feedback-icon');
    const text = document.getElementById('feedback-text');
    const feedbackQuestion = document.getElementById('feedback-question');
    const feedbackUserAnswer = document.getElementById('feedback-user-answer');
    const feedbackCorrectRow = document.getElementById('feedback-correct-row');
    const feedbackCorrectAnswer = document.getElementById('feedback-correct-answer');
    const unlockInput = document.getElementById('feedback-unlock-input');
    const detailsSection = overlay.querySelector('.feedback-details');
    const unlockSection = overlay.querySelector('.feedback-unlock');
    let continueBtn = document.getElementById('feedback-continue-btn');
    if (!continueBtn) {
        continueBtn = document.createElement('button');
        continueBtn.id = 'feedback-continue-btn';
        continueBtn.className = 'feedback-continue-btn hidden';
        continueBtn.textContent = 'CONTINUAR';
        content.appendChild(continueBtn);
    }

    if (overlay._unlockTimeout) {
        clearTimeout(overlay._unlockTimeout);
        overlay._unlockTimeout = null;
    }
    if (overlay._secretCodeHandler) {
        document.removeEventListener('keydown', overlay._secretCodeHandler);
        overlay._secretCodeHandler = null;
    }
    if (continueBtn._clickHandler) {
        continueBtn.removeEventListener('click', continueBtn._clickHandler);
        continueBtn._clickHandler = null;
    }

    content.className = 'feedback-content';
    unlockInput.value = '';
    detailsSection.style.display = 'block';
    unlockSection.style.display = 'none';
    continueBtn.classList.add('hidden');

    feedbackQuestion.innerHTML = formatQuestionHTML(questionText);
    feedbackUserAnswer.textContent = userAnswer || '(sem resposta)';

    if (type === 'correct') {
        icon.textContent = '⚔️';
        text.textContent = 'TERRITÓRIO CONQUISTADO!';
        content.classList.add('feedback-correct');
        feedbackCorrectRow.style.display = 'none';
    } else if (type === 'wrong') {
        icon.textContent = '🛡️';
        text.textContent = 'ERROU!';
        content.classList.add('feedback-wrong');
        feedbackCorrectRow.style.display = '';
        feedbackCorrectAnswer.textContent = correctAnswers.join(', ');
    } else {
        icon.textContent = '⏰';
        text.textContent = 'TEMPO ESGOTADO!';
        content.classList.add('feedback-timeout');
        feedbackCorrectRow.style.display = '';
        feedbackCorrectAnswer.textContent = correctAnswers.join(', ');
    }

    overlay.classList.remove('hidden');
    let finished = false;
    const finishReview = () => {
        if (finished) return;
        finished = true;
        if (overlay._unlockTimeout) {
            clearTimeout(overlay._unlockTimeout);
            overlay._unlockTimeout = null;
        }
        if (overlay._secretCodeHandler) {
            document.removeEventListener('keydown', overlay._secretCodeHandler);
            overlay._secretCodeHandler = null;
        }
        if (continueBtn._clickHandler) {
            continueBtn.removeEventListener('click', continueBtn._clickHandler);
            continueBtn._clickHandler = null;
        }
        continueBtn.classList.add('hidden');
        unlockInput.value = '';
        unlockInput.blur();
        if (!overlay.classList.contains('hidden')) {
            overlay.classList.add('hidden');
        }
        afterTurnEnd();
    };

    let codeBuffer = '';
    const handleSecretCode = (e) => {
        if (overlay.classList.contains('hidden')) return;
        if (!/^\d$/.test(e.key)) return;
        codeBuffer = (codeBuffer + e.key).slice(-state.secretCode.length);
        if (codeBuffer === state.secretCode) finishReview();
    };
    overlay._secretCodeHandler = handleSecretCode;
    document.addEventListener('keydown', handleSecretCode);

    const handleContinueClick = () => finishReview();
    continueBtn._clickHandler = handleContinueClick;
    continueBtn.addEventListener('click', handleContinueClick);

    overlay._unlockTimeout = setTimeout(() => {
        continueBtn.classList.remove('hidden');
        continueBtn.focus();
    }, 15000);
}

// ========== TERRITORY SELECTION MODE ==========
function getNeutralTerritories() {
    return state.territories
        .map((t, i) => t.owner === -1 ? i : -1)
        .filter(i => i >= 0);
}

function enterDraftPhase() {
    const attackBtn = document.getElementById('attack-btn');
    const banner = document.getElementById('selection-banner');
    const confirmBtn = document.getElementById('selection-confirm-btn');

    state.selectionMode = true;
    state.draftPhase = true;
    attackBtn.style.display = 'none';
    confirmBtn.classList.add('hidden');
    banner.classList.remove('hidden');

    updateDraftBanner();
    updateTurnInfo();
    updateScoreboard();
}

function updateDraftBanner() {
    const team = state.teams[state.currentTeamIndex];
    const picksDone = state.draftPickCounts[state.currentTeamIndex];
    const nextPick = picksDone + 1;
    const orderNames = state.turnOrder.map(i => state.teams[i].name).join(' -> ');
    document.getElementById('selection-banner-text').textContent =
        `Escolha inicial: ${team.name} escolhe o ${nextPick}o territorio (ordem: ${orderNames})`;
}

function finishDraftPhase() {
    state.draftPhase = false;
    state.selectionMode = false;
    state.currentOrderPos = 0;
    state.currentTeamIndex = state.turnOrder[state.currentOrderPos];
    state.round = 1;

    const attackBtn = document.getElementById('attack-btn');
    const banner = document.getElementById('selection-banner');
    const confirmBtn = document.getElementById('selection-confirm-btn');

    banner.classList.add('hidden');
    confirmBtn.classList.remove('hidden');
    attackBtn.style.display = '';
    clearHighlights();

    updateScoreboard();
    updateTurnInfo();
}

function enterSelectionMode() {
    state.selectionMode = true;
    state.claimedThisTurn = [];
    state.territoriesToClaim = state.diceResult;

    // Cap to available attackable territories
    const attackable = getSelectableTerritories(state.currentTeamIndex);
    if (state.territoriesToClaim > attackable.length) {
        state.territoriesToClaim = attackable.length;
    }

    if (state.territoriesToClaim === 0) {
        exitSelectionMode();
        return;
    }

    updateSelectionBanner();
    highlightSelectable(attackable);

    // Show banner
    document.getElementById('selection-banner').classList.remove('hidden');
    // Hide attack button during selection
    document.getElementById('attack-btn').style.display = 'none';
}

function updateSelectionBanner() {
    const remaining = state.territoriesToClaim - state.claimedThisTurn.length;
    const plural = remaining === 1 ? 'território' : 'territórios';
    document.getElementById('selection-banner-text').textContent =
        `Escolha ${remaining} ${plural} para conquistar!`;
}

function onTerritoryClick(territoryIndex) {
    if (state.draftPhase) {
        const territory = state.territories[territoryIndex];
        if (!territory || territory.owner !== -1) return;

        state.territories[territoryIndex].owner = state.currentTeamIndex;
        state.draftPickCounts[state.currentTeamIndex]++;

        updateMapColors();
        const hex = document.querySelector(`#hex-map .hex-territory[data-index="${territoryIndex}"]`);
        if (hex) {
            hex.classList.remove('selectable');
            hex.classList.add('just-claimed');
            setTimeout(() => hex.classList.remove('just-claimed'), 600);
        }

        const totalPicked = state.draftPickCounts.reduce((sum, n) => sum + n, 0);
        const totalNeeded = state.teams.length * 3;
        if (totalPicked >= totalNeeded || getNeutralTerritories().length === 0) {
            finishDraftPhase();
            return;
        }

        do {
            state.currentOrderPos = (state.currentOrderPos + 1) % state.turnOrder.length;
            state.currentTeamIndex = state.turnOrder[state.currentOrderPos];
        } while (state.draftPickCounts[state.currentTeamIndex] >= 3);

        updateDraftBanner();
        updateTurnInfo();
        updateScoreboard();
        return;
    }

    if (!state.selectionMode) return;

    const selectable = getSelectableTerritories(state.currentTeamIndex);
    if (!selectable.includes(territoryIndex)) return;

    // Claim this territory
    state.territories[territoryIndex].owner = state.currentTeamIndex;
    state.claimedThisTurn.push(territoryIndex);

    // Visual feedback
    updateMapColors();
    const hex = document.querySelector(`#hex-map .hex-territory[data-index="${territoryIndex}"]`);
    if (hex) {
        hex.classList.remove('selectable');
        hex.classList.add('just-claimed');
        setTimeout(() => hex.classList.remove('just-claimed'), 600);
    }

    // Check if all claimed
    if (state.claimedThisTurn.length >= state.territoriesToClaim) {
        setTimeout(() => exitSelectionMode(), 400);
    } else {
        // Recalculate selectable (new adjacencies opened)
        const newSelectable = getSelectableTerritories(state.currentTeamIndex);
        if (newSelectable.length === 0) {
            setTimeout(() => exitSelectionMode(), 400);
        } else {
            updateSelectionBanner();
            highlightSelectable(newSelectable);
        }
    }
}

function onConfirmSelection() {
    if (state.selectionMode && !state.draftPhase) exitSelectionMode();
}

function exitSelectionMode() {
    state.selectionMode = false;
    document.getElementById('selection-banner').classList.add('hidden');
    document.getElementById('attack-btn').style.display = '';
    clearHighlights();
    // After territory selection, show review screen with question + answer + 123
    showReviewScreen('correct', state._lastQuestion, state._lastUserAnswer, state._lastCorrectAnswers);
}

function afterTurnEnd() {
    updateScoreboard();
    updateQuestionsRemaining();
    clearHighlights();

    if (checkDomination()) {
        endGame();
        return;
    }
    nextTurn();
}

function nextTurn() {
    state.currentPlayerIndices[state.currentTeamIndex]++;
    state.currentOrderPos = (state.currentOrderPos + 1) % state.turnOrder.length;
    if (state.currentOrderPos === 0) state.round++;
    state.currentTeamIndex = state.turnOrder[state.currentOrderPos];

    state.diceResult = 0;
    state.claimedThisTurn = [];
    updateScoreboard();
    updateTurnInfo();
}

function checkDomination() {
    for (let i = 0; i < state.teams.length; i++) {
        if (state.territories.filter(t => t.owner === i).length === state.territories.length) return true;
    }
    return false;
}

// ========== END GAME ==========
function endGame() {
    state.gameEnded = true;
    clearInterval(state.timerInterval);
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('results-screen').classList.add('active');
    renderResults();
}

function renderResults() {
    const teamResults = state.teams.map((team, i) => ({
        index: i, name: team.name, color: team.color,
        territories: state.territories.filter(t => t.owner === i).length
    }));
    teamResults.sort((a, b) => b.territories - a.territories);

    const podium = document.getElementById('podium');
    podium.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉', '4º', '5º'];
    const barHeights = [220, 170, 130, 100, 80];

    teamResults.forEach((team, rank) => {
        const place = document.createElement('div');
        place.className = 'podium-place';
        place.innerHTML = `
            <div class="podium-medal">${medals[rank]}</div>
            <div class="podium-team-name" style="color:${team.color}">${team.name}</div>
            <div class="podium-territories">${team.territories} territórios</div>
            <div class="podium-bar" style="background:${team.color};height:${barHeights[rank]}px"></div>
        `;
        podium.appendChild(place);
    });
    renderMap('final-hex-map');
}

// ========== FULLSCREEN ==========
function enterFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) elem.requestFullscreen().catch(() => {});
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
}

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
    initSetupScreen();
    initAttackButton();
});
