/**
 * TransitTrack AI — Modern Client Application
 * Source of Truth: srs.md & REQUIREMENTS.md
 */

const API = "";
const TOKEN_KEY = "transittrack_token";

// DOM Elements
const loginScreen = document.getElementById("loginScreen");
const app = document.getElementById("app");
const toast = document.getElementById("toast");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const breadcrumbText = document.getElementById("breadcrumbText");
const sidebar = document.getElementById("sidebar");
const menuToggleBtn = document.getElementById("menuToggleBtn");
const mobileCloseBtn = document.getElementById("mobileCloseBtn");
const logoutButton = document.getElementById("logoutButton");
const headerSearch = document.getElementById("headerSearch");
const headerSearchForm = document.getElementById("headerSearchForm");
const searchDropdown = document.getElementById("searchResultsDropdown");

// State
let routes = [];
let historicalRecords = [];
let deleteTargetId = null;

// Helpers
function token() {
    return sessionStorage.getItem(TOKEN_KEY);
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2400);
}

function showError(element, message) {
    element.textContent = message;
    element.classList.remove("hidden");
}

function clearError(element) {
    element.textContent = "";
    element.classList.add("hidden");
}

function badge(level) {
    const cls = String(level || "").toLowerCase();
    return `<span class="badge ${cls}">${level}</span>`;
}

function formatNumber(num) {
    return Number(num || 0).toLocaleString();
}

const formatTime = (timestamp) => {
    if (!timestamp) return "";

    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
};

// API Client
async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }
    if (token()) {
        headers.Authorization = `Bearer ${token()}`;
    }
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        logout(false);
        throw new Error(data.detail || "Authentication required. Please sign in.");
    }
    if (!response.ok) {
        const detail = Array.isArray(data.detail)
            ? data.detail.map((item) => item.msg || item).join(" ")
            : data.detail || "Request failed.";
        throw new Error(detail);
    }
    return data;
}

// Authentication & Session
function logout(notify = true) {
    sessionStorage.removeItem(TOKEN_KEY);
    app.classList.add("hidden");
    loginScreen.classList.remove("hidden");
    document.getElementById("password").value = "";
    if (notify) showToast("Signed out successfully.");
}

async function startApp() {
    const me = await api("/api/auth/me");
    document.getElementById("userName").textContent = me.username;
    document.getElementById("userAvatar").textContent = me.username.slice(0, 2).toUpperCase();
    
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Update database status indicator
    try {
        const dbStatus = await api("/api/database/status");
        const dbBadge = document.getElementById("systemDbBadge");
        if (dbBadge) {
            if (dbStatus.connected) {
                dbBadge.textContent = dbStatus.provider === "supabase_pg" 
                    ? "Supabase (PostgreSQL) · Connected" 
                    : "Supabase (API) · Connected";
            } else {
                dbBadge.textContent = "Supabase PostgreSQL · Ready";
            }
        }
    } catch (_) {}

    loginScreen.classList.add("hidden");
    app.classList.remove("hidden");

    await loadRoutes();
    showSection("dashboard");
}

function updateDateTime() {
    const now = new Date();
    document.getElementById("todayDate").textContent = now.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
    document.getElementById("currentTime").textContent = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

// Populate Route Dropdowns
function fillSelect(select, items, includeBlank = true, defaultSelectedId = null) {
    if (!select) return;
    const current = defaultSelectedId || select.value;
    select.innerHTML = includeBlank ? `<option value="">-- Select Route or Station --</option>` : "";
    items.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.name} [${item.code}] (${item.kind})`;
        select.appendChild(option);
    });
    if (current && [...select.options].some((opt) => opt.value === String(current))) {
        select.value = String(current);
    }
}

async function loadRoutes() {
    routes = await api("/api/routes");
    const dropdownIds = [
        "dashQuickRoute",
        "crowdTarget",
        "riskTarget",
        "altTarget",
        "demandTarget",
        "simTarget",
        "historyRoute"
    ];
    dropdownIds.forEach((id) => {
        const select = document.getElementById(id);
        fillSelect(select, routes, id !== "historyRoute" && id !== "dashQuickRoute");
    });
}

// Section Navigation
function showSection(sectionId) {
    document.querySelectorAll(".page-section").forEach((sec) => {
        sec.classList.toggle("active-section", sec.id === sectionId);
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.section === sectionId);
    });
    const activeBtn = document.querySelector(`.nav-btn[data-section="${sectionId}"]`);
    if (activeBtn) {
        const spanText = activeBtn.querySelector("span") ? activeBtn.querySelector("span").textContent : "";
        breadcrumbText.textContent = spanText || sectionId;
    }
    if (typeof closeMobileSidebar === "function") {
        closeMobileSidebar();
    } else {
        sidebar.classList.remove("open");
    }
    searchDropdown.classList.add("hidden");

    if (sectionId === "dashboard") loadDashboard();
    else if (sectionId === "performance") loadPerformance();
    else if (sectionId === "historical") loadHistorical();
    else if (sectionId === "reports") loadReports();
    else if (sectionId === "ai-copilot") {
        const input = document.getElementById("aiChatInput");
        const messages = document.getElementById("aiChatMessages");
        if (input) setTimeout(() => input.focus(), 150);
        if (messages) messages.scrollTop = messages.scrollHeight;
    }
}

// 1. Dashboard Module (FR-07 - FR-11, NFR-06)
async function loadDashboard() {
    try {
        const data = await api("/api/dashboard");
        const headline = data.headline || {};
        
        // KPI Cards
        document.getElementById("kpiCrowd").innerHTML = headline.crowd_level ? badge(headline.crowd_level) : "—";
        document.getElementById("kpiCrowdSub").textContent = headline.route ? `${headline.route.name}` : "Stored historical status";

        document.getElementById("kpiRisk").innerHTML = headline.risk_level ? badge(headline.risk_level) : "—";
        document.getElementById("kpiRiskSub").textContent = headline.avg_delay_minutes !== undefined ? `${headline.avg_delay_minutes}m avg delay` : "Fleet assessment";

        document.getElementById("kpiDemand").textContent = formatNumber(data.demand_sample || 0);
        document.getElementById("kpiScore").textContent = `${data.avg_performance || 0} / 100`;

        // Monitored Routes Table
        const tbody = document.getElementById("dashboardTable");
        if (!data.overview || data.overview.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="table-empty-cell">No historical route data found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.overview.map((row) => `
            <tr>
                <td>
                    <strong>${row.route.name}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">Code: ${row.route.code}</div>
                </td>
                <td><span class="badge ${row.route.kind}">${row.route.kind}</span></td>
                <td>${badge(row.crowd_level)}</td>
                <td>${badge(row.risk_level)}</td>
                <td>
                    <strong style="font-family: var(--font-mono);">${row.performance_score}</strong>
                    <span style="font-size: 11px; color: var(--text-muted);">/100</span>
                </td>
                <td class="text-right">
                    <button class="table-action-btn" type="button" onclick="quickNav('crowd', ${row.route.id})">Predict</button>
                    <button class="table-action-btn" type="button" onclick="quickNav('risk', ${row.route.id})">Risk</button>
                </td>
            </tr>
        `).join("");
    } catch (err) {
        showToast("Error loading dashboard: " + err.message);
    }
}

// Quick Predict on Dashboard (NFR-06: <= 5 actions from login)
document.getElementById("dashQuickBtn").addEventListener("click", async () => {
    const targetId = document.getElementById("dashQuickRoute").value;
    const resultBox = document.getElementById("dashQuickResult");
    if (!targetId) {
        resultBox.classList.remove("hidden");
        resultBox.innerHTML = `<span style="color: var(--status-high);">Please select a transit line.</span>`;
        return;
    }
    try {
        resultBox.classList.remove("hidden");
        resultBox.innerHTML = `<span>Computing prediction...</span>`;
        const res = await api("/api/predict/crowd", {
            method: "POST",
            body: JSON.stringify({ target_id: Number(targetId) }),
        });
        resultBox.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${res.target.name}</strong>
                ${badge(res.crowd_level)}
            </div>
            <div style="margin-top:6px; color: var(--text-secondary); font-size:12px;">
                Avg ridership: <strong>${formatNumber(res.avg_ridership)}</strong> (${res.record_count} historical records)
            </div>
        `;
    } catch (err) {
        resultBox.innerHTML = `<span style="color: var(--status-high);">${err.message}</span>`;
    }
});

// Quick Navigate helper
window.quickNav = function(section, routeId) {
    showSection(section);
    if (section === "crowd") {
        document.getElementById("crowdTarget").value = routeId;
        document.getElementById("crowdButton").click();
    } else if (section === "risk") {
        document.getElementById("riskTarget").value = routeId;
        document.getElementById("riskButton").click();
    } else if (section === "alternative") {
        document.getElementById("altTarget").value = routeId;
        document.getElementById("altButton").click();
    }
};

// 2. Crowd Prediction (FR-01, FR-07, NFR-01)
document.getElementById("crowdButton").addEventListener("click", async () => {
    const error = document.getElementById("crowdError");
    clearError(error);
    const targetId = document.getElementById("crowdTarget").value;
    if (!targetId) {
        showError(error, "Please select a transit route or station.");
        return;
    }

    try {
        const result = await api("/api/predict/crowd", {
            method: "POST",
            body: JSON.stringify({ target_id: Number(targetId) }),
        });

        document.getElementById("crowdPlaceholder").classList.add("hidden");
        const content = document.getElementById("crowdContent");
        content.classList.remove("hidden");

        document.getElementById("crowdLevel").textContent = result.crowd_level;
        document.getElementById("crowdBadge").innerHTML = badge(result.crowd_level);
        document.getElementById("crowdAvgRiders").textContent = formatNumber(result.avg_ridership);
        document.getElementById("crowdCount").textContent = result.record_count;

        // Capacity Utilization Gauge
        const maxCapacity = 1600;
        const utilPercent = Math.min(100, Math.round((result.avg_ridership / maxCapacity) * 100));
        document.getElementById("crowdGaugeVal").textContent = `${utilPercent}%`;
        const gaugeBar = document.getElementById("crowdGaugeBar");
        gaugeBar.style.width = `${utilPercent}%`;

        if (result.crowd_level === "High") {
            gaugeBar.style.backgroundColor = "var(--status-high)";
        } else if (result.crowd_level === "Moderate") {
            gaugeBar.style.backgroundColor = "var(--status-med)";
        } else {
            gaugeBar.style.backgroundColor = "var(--status-low)";
        }

        document.getElementById("crowdMessage").textContent = result.message;
    } catch (err) {
        showError(error, err.message);
    }
});

// 3. Route Risk Detection (FR-02, FR-08, NFR-02)
document.getElementById("riskButton").addEventListener("click", async () => {
    const error = document.getElementById("riskError");
    clearError(error);
    const targetId = document.getElementById("riskTarget").value;
    if (!targetId) {
        showError(error, "Please select a transit route or station.");
        return;
    }

    try {
        const result = await api("/api/predict/risk", {
            method: "POST",
            body: JSON.stringify({ target_id: Number(targetId) }),
        });

        document.getElementById("riskPlaceholder").classList.add("hidden");
        const content = document.getElementById("riskContent");
        content.classList.remove("hidden");

        document.getElementById("riskLevel").textContent = result.risk_level;
        document.getElementById("riskBadge").innerHTML = badge(result.risk_level);
        document.getElementById("riskAvgDelay").textContent = `${result.avg_delay_minutes} min`;
        document.getElementById("riskCrowdFactor").textContent = result.crowd_level;

        const altReq = result.risk_level === "High" || result.risk_level === "Medium" || result.crowd_level === "High";
        document.getElementById("riskAltTrigger").innerHTML = altReq ? '<span style="color:var(--status-high);">Yes</span>' : '<span style="color:var(--status-low);">No</span>';

        // Spectrum Pointer
        const pointer = document.getElementById("riskPointer");
        if (result.risk_level === "Low") {
            pointer.style.marginLeft = "15%";
        } else if (result.risk_level === "Medium") {
            pointer.style.marginLeft = "50%";
        } else {
            pointer.style.marginLeft = "85%";
        }

        document.getElementById("riskMessage").textContent = result.message;
    } catch (err) {
        showError(error, err.message);
    }
});

// 4. Alternative Routes (FR-03, FR-09)
document.getElementById("altButton").addEventListener("click", async () => {
    const error = document.getElementById("altError");
    clearError(error);
    const targetId = document.getElementById("altTarget").value;
    if (!targetId) {
        showError(error, "Please select a route or station.");
        return;
    }

    try {
        const result = await api("/api/alternatives", {
            method: "POST",
            body: JSON.stringify({ target_id: Number(targetId) }),
        });

        const resultBlock = document.getElementById("altResultBlock");
        resultBlock.classList.remove("hidden");

        const statusCard = document.getElementById("altStatusCard");
        const statusIcon = document.getElementById("altStatusIcon");
        const statusTitle = document.getElementById("altStatusTitle");
        const suggestionsSection = document.getElementById("altSuggestionsSection");

        if (result.threshold_exceeded) {
            statusCard.className = "threshold-status-card exceeded";
            statusIcon.textContent = "!";
            statusTitle.textContent = "Operational Threshold Exceeded";
            document.getElementById("altMessage").textContent = result.message;

            suggestionsSection.classList.remove("hidden");
            const list = document.getElementById("altList");
            list.innerHTML = result.suggestions.map((item, idx) => `
                <div class="alt-card">
                    <div class="alt-card-header">
                        <strong>${item.route.name}</strong>
                        <span class="alt-rank-tag">Option #${idx + 1}</span>
                    </div>
                    <div style="display:flex; gap:6px; margin: 8px 0;">
                        ${badge(item.crowd_level)}
                        ${badge(item.risk_level)}
                    </div>
                    <div class="alt-metrics-row">
                        <div>Score: <strong>${item.performance_score}/100</strong></div>
                        <div>Delay: <strong>${item.avg_delay_minutes}m</strong></div>
                        <div>Riders: <strong>${formatNumber(item.avg_ridership)}</strong></div>
                    </div>
                </div>
            `).join("") || "<p>No suitable lower-risk alternatives found.</p>";
        } else {
            statusCard.className = "threshold-status-card ok";
            statusIcon.textContent = "✓";
            statusTitle.textContent = "Route Operating Normally";
            document.getElementById("altMessage").textContent = result.message;
            suggestionsSection.classList.add("hidden");
        }
    } catch (err) {
        showError(error, err.message);
    }
});

// 5. Demand Forecast (FR-04, FR-10) with SVG Chart
document.getElementById("demandButton").addEventListener("click", async () => {
    const error = document.getElementById("demandError");
    clearError(error);
    const targetId = document.getElementById("demandTarget").value;
    const periodDays = Number(document.getElementById("forecastPeriod").value);
    if (!targetId) {
        showError(error, "Please select a transit route or station.");
        return;
    }

    try {
        const result = await api("/api/forecast/demand", {
            method: "POST",
            body: JSON.stringify({ target_id: Number(targetId), period_days: periodDays }),
        });

        document.getElementById("demandSummary").textContent = `${result.message} Projected daily average: ${formatNumber(result.daily_average)} passengers.`;
        document.getElementById("demandMetaBox").classList.remove("hidden");
        document.getElementById("demandTotalVal").textContent = `${formatNumber(result.total)} passengers`;
        document.getElementById("demandAvgVal").textContent = `${formatNumber(result.daily_average)} / day`;

        renderSvgChart(result.points);
    } catch (err) {
        showError(error, err.message);
    }
});

function renderSvgChart(points) {
    const svg = document.getElementById("demandSvgChart");
    const tooltip = document.getElementById("chartTooltip");
    svg.innerHTML = "";

    if (!points || points.length === 0) return;

    const width = 600;
    const height = 240;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...points.map((p) => p.demand), 100);
    const colWidth = chartW / points.length;
    const barWidth = Math.max(10, colWidth * 0.65);

    // Horizontal gridlines
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartH / 4) * i;
        const val = Math.round(maxVal - (maxVal / 4) * i);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", width - padding.right);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", "#e2e8f0");
        line.setAttribute("stroke-dasharray", "3 3");
        svg.appendChild(line);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", padding.left - 8);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "end");
        text.setAttribute("font-size", "10");
        text.setAttribute("fill", "#94a3b8");
        text.textContent = (val / 1000).toFixed(1) + "k";
        svg.appendChild(text);
    }

    // Bars
    points.forEach((point, i) => {
        const barH = (point.demand / maxVal) * chartH;
        const x = padding.left + i * colWidth + (colWidth - barWidth) / 2;
        const y = padding.top + chartH - barH;

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", barWidth);
        rect.setAttribute("height", barH);
        rect.setAttribute("rx", "4");
        rect.setAttribute("fill", "url(#barGradient)");
        rect.style.cursor = "pointer";

        rect.addEventListener("mouseenter", (e) => {
            rect.setAttribute("opacity", "0.85");
            tooltip.innerHTML = `<strong>${point.label}</strong><br>${formatNumber(point.demand)} riders`;
            tooltip.classList.remove("hidden");
            const box = svg.getBoundingClientRect();
            tooltip.style.left = `${(x + barWidth / 2) * (box.width / width)}px`;
            tooltip.style.top = `${y * (box.height / height)}px`;
        });

        rect.addEventListener("mouseleave", () => {
            rect.setAttribute("opacity", "1");
            tooltip.classList.add("hidden");
        });

        svg.appendChild(rect);

        // X Label
        if (points.length <= 14 || i % 2 === 0) {
            const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", x + barWidth / 2);
            label.setAttribute("y", height - 12);
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("font-size", "10");
            label.setAttribute("fill", "#64748b");
            label.textContent = point.label.replace("Day ", "D");
            svg.appendChild(label);
        }
    });

    // Gradient Def
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
        <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0ea5e9" />
            <stop offset="100%" stop-color="#0284c7" />
        </linearGradient>
    `;
    svg.prepend(defs);
}

// 6. Performance Scores (FR-05, FR-11)
async function loadPerformance() {
    const grid = document.getElementById("performanceGrid");
    try {
        const rows = await api("/api/performance");
        if (!rows || rows.length === 0) {
            grid.innerHTML = `<p class="table-empty-cell">No route performance records available.</p>`;
            return;
        }

        grid.innerHTML = rows.map((row) => {
            let grade = "C";
            let gradeCls = "c";
            if (row.performance_score >= 90) { grade = "A"; gradeCls = "a"; }
            else if (row.performance_score >= 75) { grade = "B"; gradeCls = "b"; }
            else if (row.performance_score < 60) { grade = "D"; gradeCls = "d"; }

            return `
                <div class="scorecard">
                    <div class="scorecard-top">
                        <div>
                            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted);">CODE: ${row.route.code}</span>
                            <h3>${row.route.name}</h3>
                        </div>
                        <div class="grade-badge ${gradeCls}">${grade}</div>
                    </div>

                    <div class="scorecard-meter">
                        <div class="score-num-display">
                            <strong>${row.performance_score}</strong>
                            <span>/ 100</span>
                        </div>
                        <div class="score-progress-track">
                            <div class="score-progress-fill" style="width: ${row.performance_score}%;"></div>
                        </div>
                    </div>

                    <div class="scorecard-footer">
                        <div>Delay: <strong>${row.avg_delay_minutes}m</strong></div>
                        <div>Riders: <strong>${formatNumber(row.avg_ridership)}</strong></div>
                        <div>${badge(row.crowd_level)}</div>
                    </div>
                </div>
            `;
        }).join("");
    } catch (err) {
        grid.innerHTML = `<p class="alert-box error">${err.message}</p>`;
    }
}

// 7. What-If Simulation (FR-06, FR-12, NFR-03)
document.getElementById("simulationButton").addEventListener("click", async () => {
    const error = document.getElementById("simError");
    clearError(error);
    const targetId = document.getElementById("simTarget").value;
    const scenario = document.getElementById("scenario").value.trim();
    const demandChange = Number(document.getElementById("demandChange").value);
    const delayChange = Number(document.getElementById("delayChange").value);

    if (!targetId) {
        showError(error, "Please select a route or station.");
        return;
    }
    if (scenario.length < 3) {
        showError(error, "Please describe the hypothetical scenario (min 3 chars).");
        return;
    }

    try {
        const result = await api("/api/simulate", {
            method: "POST",
            body: JSON.stringify({
                target_id: Number(targetId),
                scenario,
                demand_change_percent: demandChange,
                delay_change_minutes: delayChange,
            }),
        });

        document.getElementById("simPlaceholder").classList.add("hidden");
        const content = document.getElementById("simContent");
        content.classList.remove("hidden");

        document.getElementById("simScenarioName").textContent = `"${result.scenario}"`;

        // Baseline
        document.getElementById("simBaseCrowd").textContent = result.baseline.crowd_level;
        document.getElementById("simBaseRisk").textContent = result.baseline.risk_level;
        document.getElementById("simBaseDemand").textContent = formatNumber(result.baseline.avg_ridership);
        document.getElementById("simBaseScore").textContent = `${result.baseline.performance_score}/100`;

        // Simulated
        document.getElementById("simResCrowd").textContent = result.result.crowd_level;
        document.getElementById("simResRisk").textContent = result.result.risk_level;
        document.getElementById("simResDemand").textContent = formatNumber(result.result.demand);
        document.getElementById("simResScore").textContent = `${result.result.performance_score}/100`;

        // Deltas
        const deltaRow = document.getElementById("simDeltaRow");
        const deltaRiders = result.result.delta_demand;
        const deltaDelay = result.result.delta_delay;
        const deltaScore = result.result.delta_score;

        deltaRow.innerHTML = `
            <span class="delta-pill ${deltaRiders >= 0 ? 'positive' : 'negative'}">
                ${deltaRiders >= 0 ? '+' : ''}${formatNumber(deltaRiders)} Riders (${demandChange >= 0 ? '+' : ''}${demandChange}%)
            </span>
            <span class="delta-pill ${deltaDelay <= 0 ? 'positive' : 'negative'}">
                ${deltaDelay >= 0 ? '+' : ''}${deltaDelay}m Delay
            </span>
            <span class="delta-pill ${deltaScore >= 0 ? 'positive' : 'negative'}">
                ${deltaScore >= 0 ? '+' : ''}${deltaScore} Score Pts
            </span>
        `;

        document.getElementById("simulationMessage").textContent = result.message;
    } catch (err) {
        showError(error, err.message);
    }
});

// Simulation Presets
document.querySelectorAll(".preset-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
        const type = pill.dataset.preset;
        if (type === "event") {
            document.getElementById("scenario").value = "Downtown Sports Championship Rush";
            document.getElementById("demandChange").value = 30;
            document.getElementById("delayChange").value = 10;
        } else if (type === "weather") {
            document.getElementById("scenario").value = "Severe Winter Blizzard Advisory";
            document.getElementById("demandChange").value = -10;
            document.getElementById("delayChange").value = 20;
        } else if (type === "offpeak") {
            document.getElementById("scenario").value = "Midday Off-Peak Timetable Adjustment";
            document.getElementById("demandChange").value = -25;
            document.getElementById("delayChange").value = -2;
        }
    });
});

// 8. Historical Data CRUD (FR-13)
async function loadHistorical(query = "") {
    try {
        const rows = await api(`/api/historical?q=${encodeURIComponent(query)}`);
        historicalRecords = rows;
        document.getElementById("recordCountBadge").textContent = `${rows.length} records`;

        const tbody = document.getElementById("historicalTable");
        if (!rows || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="table-empty-cell">No historical records match your query.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map((r) => `
            <tr>
                <td><span style="font-family:var(--font-mono); color:var(--text-muted);">${r.id}</span></td>
                <td>
                    <strong>${r.route_name || 'Route ' + r.route_code}</strong>
                    <div style="font-size:11px; color:var(--text-muted);">${r.route_code}</div>
                </td>
                <td>${r.record_date}</td>
                <td>${r.schedule_time}</td>
                <td>${r.delay_minutes} min</td>
                <td>${formatNumber(r.ridership)}</td>
                <td class="text-right">
                    <button class="table-action-btn" type="button" onclick="editRecord(${r.id})">Edit</button>
                    <button class="table-action-btn delete" type="button" onclick="confirmDeleteRecord(${r.id})">Delete</button>
                </td>
            </tr>
        `).join("");
    } catch (err) {
        showToast("Error loading historical records: " + err.message);
    }
}

// Modal Handling for Add / Edit
const recordModal = document.getElementById("recordModal");
const deleteModal = document.getElementById("deleteModal");

document.getElementById("openAddModalBtn").addEventListener("click", () => {
    document.getElementById("modalTitle").textContent = "Add Historical Transit Record";
    document.getElementById("historyId").value = "";
    document.getElementById("historyForm").reset();
    clearError(document.getElementById("historyError"));
    recordModal.classList.remove("hidden");
});

document.getElementById("modalCloseBtn").addEventListener("click", () => recordModal.classList.add("hidden"));
document.getElementById("modalCancelBtn").addEventListener("click", () => recordModal.classList.add("hidden"));

window.editRecord = function(id) {
    const record = historicalRecords.find((r) => r.id === id);
    if (!record) return;
    document.getElementById("modalTitle").textContent = `Edit Historical Record #${record.id}`;
    document.getElementById("historyId").value = record.id;
    document.getElementById("historyRoute").value = record.route_id;
    document.getElementById("historyDate").value = record.record_date;
    document.getElementById("historyTime").value = record.schedule_time;
    document.getElementById("historyDelay").value = record.delay_minutes;
    document.getElementById("historyRidership").value = record.ridership;
    clearError(document.getElementById("historyError"));
    recordModal.classList.remove("hidden");
};

// Form Save (Create / Update)
document.getElementById("historyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = document.getElementById("historyError");
    clearError(error);

    const id = document.getElementById("historyId").value;
    const payload = {
        route_id: Number(document.getElementById("historyRoute").value),
        record_date: document.getElementById("historyDate").value,
        schedule_time: document.getElementById("historyTime").value,
        delay_minutes: Number(document.getElementById("historyDelay").value),
        ridership: Number(document.getElementById("historyRidership").value),
    };

    if (!payload.route_id || !payload.record_date || !payload.schedule_time) {
        showError(error, "Please fill in all required fields.");
        return;
    }

    try {
        if (id) {
            await api(`/api/historical/${id}`, { method: "PUT", body: JSON.stringify(payload) });
            showToast("Record updated successfully.");
        } else {
            await api("/api/historical", { method: "POST", body: JSON.stringify(payload) });
            showToast("New record created successfully.");
        }
        recordModal.classList.add("hidden");
        loadHistorical(document.getElementById("tableSearch").value);
        loadDashboard();
    } catch (err) {
        showError(error, err.message);
    }
});

// Delete Confirmation
window.confirmDeleteRecord = function(id) {
    deleteTargetId = id;
    document.getElementById("deleteRecordId").value = id;
    deleteModal.classList.remove("hidden");
};

document.getElementById("deleteModalClose").addEventListener("click", () => deleteModal.classList.add("hidden"));
document.getElementById("deleteCancelBtn").addEventListener("click", () => deleteModal.classList.add("hidden"));

document.getElementById("deleteConfirmBtn").addEventListener("click", async () => {
    if (!deleteTargetId) return;
    try {
        await api(`/api/historical/${deleteTargetId}`, { method: "DELETE" });
        deleteModal.classList.add("hidden");
        showToast("Historical record deleted.");
        loadHistorical(document.getElementById("tableSearch").value);
        loadDashboard();
    } catch (err) {
        showToast("Delete failed: " + err.message);
    }
});

// Historical Instant Search
let searchTimer = null;
document.getElementById("tableSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadHistorical(e.target.value), 200);
});

// 9. Combined Reports (FR-05, FR-11)
async function loadReports() {
    try {
        const report = await api("/api/reports");
        document.getElementById("reportMetaTimestamp").textContent = `Generated ${report.generated_at}`;

        // Summary Bar
        const totalLines = report.rows.length;
        const avgScore = Math.round(report.rows.reduce((acc, r) => acc + r.performance_score, 0) / (totalLines || 1));
        const total7Day = report.rows.reduce((acc, r) => acc + r.forecast_7_day_total, 0);

        document.getElementById("reportSummaryBar").innerHTML = `
            <div class="report-summary-stat">Monitored Lines: <strong>${totalLines}</strong></div>
            <div class="report-summary-stat">Fleet Avg Score: <strong>${avgScore} / 100</strong></div>
            <div class="report-summary-stat">7-Day Demand Forecast: <strong>${formatNumber(total7Day)} passengers</strong></div>
        `;

        document.getElementById("reportTable").innerHTML = report.rows.map((row) => `
            <tr>
                <td><span style="font-family:var(--font-mono);">${row.route.code}</span></td>
                <td><strong>${row.route.name}</strong></td>
                <td><span class="badge ${row.route.kind}">${row.route.kind}</span></td>
                <td>${badge(row.crowd_level)}</td>
                <td>${badge(row.risk_level)}</td>
                <td><strong style="font-family:var(--font-mono);">${row.performance_score}</strong></td>
                <td>${row.avg_delay_minutes} min</td>
                <td>${formatNumber(row.forecast_7_day_total)}</td>
            </tr>
        `).join("");
    } catch (err) {
        showToast("Error loading report: " + err.message);
    }
}

document.getElementById("printReportBtn").addEventListener("click", () => window.print());

// 10. Header Search Dropdown
headerSearch.addEventListener("input", async (e) => {
    const query = e.target.value.trim();
    if (!query) {
        searchDropdown.classList.add("hidden");
        return;
    }
    try {
        const res = await api(`/api/search?q=${encodeURIComponent(query)}`);
        searchDropdown.classList.remove("hidden");
        let html = "";

        if (res.routes && res.routes.length > 0) {
            html += `<div class="search-dropdown-title">Matching Routes & Stations</div>`;
            html += res.routes.map((rt) => `
                <div class="search-result-item" onclick="selectSearchRoute(${rt.id})">
                    <strong>${rt.name} [${rt.code}]</strong>
                    <span class="badge ${rt.kind}">${rt.kind}</span>
                </div>
            `).join("");
        }

        if (res.records && res.records.length > 0) {
            html += `<div class="search-dropdown-title" style="margin-top:10px;">Matching Historical Records (${res.records.length})</div>`;
            html += res.records.slice(0, 5).map((rec) => `
                <div class="search-result-item" onclick="selectSearchRecord('${query}')">
                    <span>${rec.route_name} · ${rec.record_date} (${rec.schedule_time})</span>
                    <small>${formatNumber(rec.ridership)} riders</small>
                </div>
            `).join("");
        }

        if (!html) {
            html = `<div style="padding:10px; color:var(--text-muted); font-size:12px;">No matches found for "${query}"</div>`;
        }

        searchDropdown.innerHTML = html;
    } catch (err) {
        // silent search fail
    }
});

window.selectSearchRoute = function(routeId) {
    searchDropdown.classList.add("hidden");
    quickNav("crowd", routeId);
};

window.selectSearchRecord = function(query) {
    searchDropdown.classList.add("hidden");
    showSection("historical");
    document.getElementById("tableSearch").value = query;
    loadHistorical(query);
};

headerSearchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = headerSearch.value.trim();
    if (query) {
        selectSearchRecord(query);
    }
});

// Close search dropdown on click outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".header-search-wrap")) {
        searchDropdown.classList.add("hidden");
    }
});

// Event Listeners: Navigation
document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showSection(btn.dataset.section));
});

document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => showSection(btn.dataset.go));
});

// Quick AI Copilot Header Button
const headerAiBtn = document.getElementById("headerAiBtn");
if (headerAiBtn) {
    headerAiBtn.addEventListener("click", () => {
        showSection("ai-copilot");
    });
}

// ============================================================================
// AI OPERATIONS COPILOT CONTROLLER
// ============================================================================
let aiChatHistory = [];
let lastAiUserQuery = "";

const aiChatMessages = document.getElementById("aiChatMessages");
const aiTypingIndicator = document.getElementById("aiTypingIndicator");
const aiChatError = document.getElementById("aiChatError");
const aiChatErrorText = document.getElementById("aiChatErrorText");
const aiChatRetryBtn = document.getElementById("aiChatRetryBtn");
const aiChatForm = document.getElementById("aiChatForm");
const aiChatInput = document.getElementById("aiChatInput");
const aiChatSendBtn = document.getElementById("aiChatSendBtn");
const aiClearChatBtn = document.getElementById("aiClearChatBtn");
const aiCharCounter = document.getElementById("aiCharCounter");
const aiModelBadgeText = document.getElementById("aiModelBadgeText");

function formatAiMarkdown(text) {
    if (!text) return "";
    const escapeHtml = (str) =>
        str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const lines = text.split("\n");
    let html = "";
    let inList = false;
    let inOrderedList = false;

    for (let rawLine of lines) {
        let line = escapeHtml(rawLine);
        // Replace bold **text**
        line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        // Replace inline `code`
        line = line.replace(/`(.*?)`/g, "<code>$1</code>");

        // Headers
        if (line.startsWith("### ")) {
            if (inList) { html += "</ul>"; inList = false; }
            if (inOrderedList) { html += "</ol>"; inOrderedList = false; }
            html += `<h3>${line.slice(4)}</h3>`;
            continue;
        }
        if (line.startsWith("## ")) {
            if (inList) { html += "</ul>"; inList = false; }
            if (inOrderedList) { html += "</ol>"; inOrderedList = false; }
            html += `<h3>${line.slice(3)}</h3>`;
            continue;
        }

        // Bullet lists
        if (line.trim().startsWith("* ") || line.trim().startsWith("- ")) {
            if (inOrderedList) { html += "</ol>"; inOrderedList = false; }
            if (!inList) { html += "<ul>"; inList = true; }
            const itemText = line.trim().replace(/^[\*\-]\s+/, "");
            html += `<li>${itemText}</li>`;
            continue;
        }

        // Numbered lists
        const numMatch = line.trim().match(/^\d+\.\s+(.*)/);
        if (numMatch) {
            if (inList) { html += "</ul>"; inList = false; }
            if (!inOrderedList) { html += "<ol>"; inOrderedList = true; }
            html += `<li>${numMatch[1]}</li>`;
            continue;
        }

        // Close open lists
        if (inList) { html += "</ul>"; inList = false; }
        if (inOrderedList) { html += "</ol>"; inOrderedList = false; }

        if (line.trim().length === 0) {
            continue;
        }

        html += `<p>${line}</p>`;
    }

    if (inList) html += "</ul>";
    if (inOrderedList) html += "</ol>";
    return html;
}

function appendChatMessage(role, content, timestamp = new Date()) {
    if (!aiChatMessages) return;

    // Hide welcome card once a conversation begins
    const welcomeCard = document.getElementById("aiWelcomeCard");
    if (welcomeCard && !welcomeCard.classList.contains("hidden")) {
        welcomeCard.classList.add("hidden");
    }

    const timeStr = formatTime(timestamp);

    const msgEl = document.createElement("div");
    msgEl.className = `ai-message ${role}`;

    const avatarText = role === "user" ? "OP" : "AI";
    const formattedBody = role === "user" 
        ? `<p>${content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` 
        : formatAiMarkdown(content);

    msgEl.innerHTML = `
        <div class="ai-msg-avatar" title="${role === 'user' ? 'Operator' : 'AI Copilot'}">${avatarText}</div>
        <div class="ai-msg-content">
            <div class="ai-msg-bubble">${formattedBody}</div>
            <span class="ai-msg-meta">${role === "user" ? "Dispatcher" : "Copilot"} · ${timeStr}</span>
        </div>
    `;

    aiChatMessages.appendChild(msgEl);
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
}

async function handleSendAiChat(messageText) {
    const text = (messageText || "").trim();
    if (!text) return;

    lastAiUserQuery = text;
    if (aiChatError) aiChatError.classList.add("hidden");

    // Append operator message to view
    appendChatMessage("user", text);
    aiChatHistory.push({ role: "user", content: text });

    if (aiChatInput) {
        aiChatInput.value = "";
        aiChatInput.style.height = "auto";
    }
    if (aiCharCounter) {
        aiCharCounter.textContent = "0 / 1000";
    }

    // Set UI loading state
    if (aiTypingIndicator) aiTypingIndicator.classList.remove("hidden");
    if (aiChatSendBtn) aiChatSendBtn.disabled = true;
    if (aiChatMessages) aiChatMessages.scrollTop = aiChatMessages.scrollHeight;

    try {
        const response = await api("/api/ai/chat", {
            method: "POST",
            body: JSON.stringify({
                message: text,
                history: aiChatHistory.slice(-8),
            }),
        });

        if (aiModelBadgeText && response.model) {
            aiModelBadgeText.textContent = response.model === "gemini-3.8-flash" 
                ? "Gemini 3.8 Flash · Active" 
                : "Transit Intelligence Engine";
        }

        const reply = response.reply || "Telemetry snapshot received. No additional dispatch alerts required.";
        appendChatMessage("assistant", reply, response.timestamp || new Date());
        aiChatHistory.push({ role: "model", content: reply });
    } catch (err) {
        console.error("[AI Copilot] Communication error:", err);
        if (aiChatError && aiChatErrorText) {
            aiChatErrorText.textContent = err.message || "Failed to contact AI Copilot. Check network and credentials.";
            aiChatError.classList.remove("hidden");
        }
    } finally {
        if (aiTypingIndicator) aiTypingIndicator.classList.add("hidden");
        if (aiChatSendBtn) aiChatSendBtn.disabled = false;
        if (aiChatInput) aiChatInput.focus();
    }
}

// Quick Prompt Chips Event Listeners
document.querySelectorAll(".ai-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
        const prompt = chip.dataset.prompt;
        if (prompt) {
            handleSendAiChat(prompt);
        }
    });
});

// Chat Form Submission
if (aiChatForm) {
    aiChatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (aiChatInput) {
            handleSendAiChat(aiChatInput.value);
        }
    });
}

// Textarea Keyboard & Auto-resize
if (aiChatInput) {
    aiChatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendAiChat(aiChatInput.value);
        }
    });

    aiChatInput.addEventListener("input", () => {
        if (aiCharCounter) {
            aiCharCounter.textContent = `${aiChatInput.value.length} / 1000`;
        }
        // Auto-grow height up to 120px
        aiChatInput.style.height = "auto";
        aiChatInput.style.height = Math.min(aiChatInput.scrollHeight, 120) + "px";
    });
}

// Retry Button
if (aiChatRetryBtn) {
    aiChatRetryBtn.addEventListener("click", () => {
        if (lastAiUserQuery) {
            handleSendAiChat(lastAiUserQuery);
        }
    });
}

// Clear Chat Button
if (aiClearChatBtn) {
    aiClearChatBtn.addEventListener("click", () => {
        aiChatHistory = [];
        if (aiChatMessages) {
            aiChatMessages.innerHTML = `
                <div class="ai-welcome-card" id="aiWelcomeCard">
                    <div class="ai-welcome-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12a10 10 0 0 1 10-10z"/><path d="m9 12 2 2 4-4"/></svg>
                    </div>
                    <h3>TransitTrack AI Operations Copilot</h3>
                    <p>I am your real-time dispatch and situational intelligence assistant. Ask questions in natural language about route delays, crowding, alternative routes, or emergency contingency protocols.</p>
                    <div class="ai-welcome-capabilities">
                        <div class="ai-cap-item">
                            <strong>Telemetry Grounded</strong>
                            <span>Analyzes live records across all 5 transit lines</span>
                        </div>
                        <div class="ai-cap-item">
                            <strong>Risk & Crowding Mitigation</strong>
                            <span>Instant alternative routing recommendations</span>
                        </div>
                        <div class="ai-cap-item">
                            <strong>What-If Analysis</strong>
                            <span>Generates weather and passenger surge protocols</span>
                        </div>
                    </div>
                </div>
            `;
        }
        if (aiChatError) aiChatError.classList.add("hidden");
        showToast("AI Copilot conversation cleared.");
    });
}

function closeMobileSidebar() {
    sidebar.classList.remove("open");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) backdrop.classList.remove("active");
    document.body.classList.remove("sidebar-open-scroll-lock");
}

function openMobileSidebar() {
    sidebar.classList.add("open");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) backdrop.classList.add("active");
    document.body.classList.add("sidebar-open-scroll-lock");
}

const sidebarBackdrop = document.getElementById("sidebarBackdrop");
if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", closeMobileSidebar);
}

menuToggleBtn.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) {
        closeMobileSidebar();
    } else {
        openMobileSidebar();
    }
});
mobileCloseBtn.addEventListener("click", closeMobileSidebar);
logoutButton.addEventListener("click", () => logout());

// Login Form Submit
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError(loginError);
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username) {
        showError(loginError, "Username is required.");
        return;
    }
    if (password.length < 8) {
        showError(loginError, "Password must be at least 8 characters (NFR-04).");
        return;
    }

    try {
        const data = await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        sessionStorage.setItem(TOKEN_KEY, data.token);
        showToast("Signed in as " + data.username);
        await startApp();
    } catch (err) {
        showError(loginError, err.message);
    }
});

// Check Session on Init
if (token()) {
    startApp().catch(() => logout(false));
}

// ==========================================================================
// 10. Progressive Web App (PWA) Integration Module
// ==========================================================================

let deferredInstallPrompt = null;

function isAppInStandaloneMode() {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true ||
        document.referrer.includes("android-app://")
    );
}

function isIOSDevice() {
    const ua = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(ua) && !window.MSStream;
}

function updateStandaloneUI() {
    const isStandalone = isAppInStandaloneMode();
    if (isStandalone) {
        document.body.classList.add("standalone-mode");
        const headerInstallBtn = document.getElementById("headerInstallBtn");
        const sidebarInstallBtn = document.getElementById("sidebarInstallBtn");
        const pwaInstallBanner = document.getElementById("pwaInstallBanner");
        if (headerInstallBtn) headerInstallBtn.classList.add("hidden");
        if (sidebarInstallBtn) sidebarInstallBtn.classList.add("hidden");
        if (pwaInstallBanner) pwaInstallBanner.classList.add("hidden");
    }
}

function setupPWA() {
    const headerInstallBtn = document.getElementById("headerInstallBtn");
    const sidebarInstallBtn = document.getElementById("sidebarInstallBtn");
    const pwaInstallBanner = document.getElementById("pwaInstallBanner");
    const pwaBannerInstallBtn = document.getElementById("pwaBannerInstallBtn");
    const pwaBannerDismissBtn = document.getElementById("pwaBannerDismissBtn");
    const iosInstallModal = document.getElementById("iosInstallModal");
    const iosModalClose = document.getElementById("iosModalClose");
    const iosModalDoneBtn = document.getElementById("iosModalDoneBtn");
    const pwaOfflineIndicator = document.getElementById("pwaOfflineIndicator");

    updateStandaloneUI();

    // Listen for display-mode changes
    try {
        window.matchMedia("(display-mode: standalone)").addEventListener("change", () => {
            updateStandaloneUI();
        });
    } catch (e) {
        // Fallback for older browsers
    }

    // 1. Service Worker Registration
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", async () => {
            try {
                const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
                console.log("[PWA] Service Worker registered with scope:", registration.scope);

                registration.addEventListener("updatefound", () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener("statechange", () => {
                            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                                console.log("[PWA] New operational cache available.");
                            }
                        });
                    }
                });
            } catch (err) {
                console.warn("[PWA] Service Worker registration note:", err.message);
            }
        });
    }

    // 2. Connectivity Listeners (Online / Offline Indicator)
    function updateOnlineStatus() {
        if (!navigator.onLine) {
            if (pwaOfflineIndicator) pwaOfflineIndicator.classList.remove("hidden");
        } else {
            if (pwaOfflineIndicator && !pwaOfflineIndicator.classList.contains("hidden")) {
                pwaOfflineIndicator.classList.add("hidden");
                showToast("Connection restored. Transit telemetry synchronizing.");
            }
        }
    }
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    if (!navigator.onLine) updateOnlineStatus();

    // 3. In-App Install Prompt Handling (Chromium / Desktop / Android)
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;

        if (!isAppInStandaloneMode()) {
            if (headerInstallBtn) headerInstallBtn.classList.remove("hidden");
            if (sidebarInstallBtn) sidebarInstallBtn.classList.remove("hidden");

            const isDismissed = sessionStorage.getItem("pwa_banner_dismissed");
            if (pwaInstallBanner && !isDismissed) {
                setTimeout(() => {
                    pwaInstallBanner.classList.remove("hidden");
                }, 1800);
            }
        }
    });

    async function triggerInstallFlow() {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            console.log("[PWA] Install prompt outcome:", outcome);
            deferredInstallPrompt = null;
            if (headerInstallBtn) headerInstallBtn.classList.add("hidden");
            if (sidebarInstallBtn) sidebarInstallBtn.classList.add("hidden");
            if (pwaInstallBanner) pwaInstallBanner.classList.add("hidden");
        } else if (isIOSDevice() && !isAppInStandaloneMode()) {
            if (iosInstallModal) iosInstallModal.classList.remove("hidden");
        } else {
            showToast("To install TransitTrack, open your browser menu (⋮) and select 'Install app' or 'Add to Home screen'.");
        }
    }

    if (headerInstallBtn) headerInstallBtn.addEventListener("click", triggerInstallFlow);
    if (sidebarInstallBtn) sidebarInstallBtn.addEventListener("click", triggerInstallFlow);
    if (pwaBannerInstallBtn) pwaBannerInstallBtn.addEventListener("click", triggerInstallFlow);

    if (pwaBannerDismissBtn) {
        pwaBannerDismissBtn.addEventListener("click", () => {
            if (pwaInstallBanner) pwaInstallBanner.classList.add("hidden");
            sessionStorage.setItem("pwa_banner_dismissed", "true");
        });
    }

    // 4. iOS Safari Support
    if (isIOSDevice() && !isAppInStandaloneMode()) {
        if (headerInstallBtn) headerInstallBtn.classList.remove("hidden");
        if (sidebarInstallBtn) sidebarInstallBtn.classList.remove("hidden");
    }

    const closeIosModal = () => {
        if (iosInstallModal) iosInstallModal.classList.add("hidden");
    };
    if (iosModalClose) iosModalClose.addEventListener("click", closeIosModal);
    if (iosModalDoneBtn) iosModalDoneBtn.addEventListener("click", closeIosModal);
    if (iosInstallModal) {
        iosInstallModal.addEventListener("click", (e) => {
            if (e.target === iosInstallModal) closeIosModal();
        });
    }

    // 5. App Installed Notification
    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        if (headerInstallBtn) headerInstallBtn.classList.add("hidden");
        if (sidebarInstallBtn) sidebarInstallBtn.classList.add("hidden");
        if (pwaInstallBanner) pwaInstallBanner.classList.add("hidden");
        document.body.classList.add("standalone-mode");
        showToast("TransitTrack AI installed! Launch it anytime from your home screen.");
        console.log("[PWA] Application successfully installed into system shell.");
    });
}

// Initialize PWA subsystem
setupPWA();

