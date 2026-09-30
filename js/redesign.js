// STATS 401 - Visualization Critique and Redesign
//
// Redesign of Figure 2.1 of the World Happiness Report 2026 (a ranked stacked
// bar chart of 147 countries) as three linked views:
//
// Dot plot : one row per country. dot = mean life evaluation, line = 95% CI.
//            The rank column shows the range of ranks a country cannot be
//            separated from (countries whose intervals overlap its own).
// Scatter  : life evaluation against ONE explanatory factor at a time, so the
//            factor is read on its own axis instead of inside a stack.
// Profile  : the selected country's six factors as bars on a common baseline,
//            plus its residual as a bar that can point left (negative).
//
// Selecting a country (click or search) keeps the countries whose intervals
// overlap it in full colour and fades the rest, in the dot plot.

const DATA_PATH = "data/whr26_2025.csv";
const DYSTOPIA = 1.16;

const FACTORS = [
    { key: "gdp", label: "GDP per capita" },
    { key: "social", label: "Social support" },
    { key: "health", label: "Healthy life expectancy" },
    { key: "freedom", label: "Freedom to make life choices" },
    { key: "generosity", label: "Generosity" },
    { key: "corruption", label: "Perceptions of corruption" },
];
const RESIDUAL = { key: "residual", label: "Unexplained by the six factors (residual)" };
const MEASURES = [...FACTORS, RESIDUAL];

const SCORE_DOMAIN = [1, 8];
const FACTOR_DOMAIN = [0, 2.2];      // shared by all six factors
const RESIDUAL_DOMAIN = [-1.6, 1.6];
const PROFILE_DOMAIN = [-1.6, 2.3];

// Dot plot geometry (viewBox units)
const DOT_W = 640;
const DOT_M = { left: 214, right: 48 };
const RANK_X = 60;
const NAME_X = 70;
const ROW_H = 15;
const HEADER_H = 30;
const BLOCK_GAP = 12;
const AXIS_H = 46;

// Scatter geometry
const SC_W = 560;
const SC_H = 330;
const SC_M = { top: 14, right: 18, bottom: 40, left: 42 };
const HOVER_RADIUS = 30;

// Profile geometry
const PR_W = 560;
const PR_M = { top: 20, right: 52, bottom: 6, left: 168 };
const PR_ROW_H = 22;

const MOVE_MS = 600;

const fmt2 = d3.format(".2f");
const fmtSigned = d3.format("+.2f");
const fmtSignedTick = d => d === 0 ? "0" : d3.format("+.1f")(d);

const tooltip = d3.select("#tooltip");

d3.csv(DATA_PATH, d => ({
    rank: +d.rank,
    country: d.country,
    region: d.region,
    score: +d.score,
    ci_low: +d.ci_low,
    ci_high: +d.ci_high,
    // Two countries lack one factor each (and so the residual): keep those
    // cells as null rather than letting them become 0.
    ...Object.fromEntries(MEASURES.map(m => [m.key, d[m.key] === "" ? null : +d[m.key]])),
})).then(init);


function overlaps(a, b) {
    return a.ci_low <= b.ci_high && b.ci_low <= a.ci_high;
}

function rankRangeText(d) {
    return d.rankLow === d.rankHigh ? `${d.rankLow}` : `${d.rankLow}–${d.rankHigh}`;
}

function pearson(rows, xKey, yKey) {
    const mx = d3.mean(rows, d => d[xKey]);
    const my = d3.mean(rows, d => d[yKey]);
    const sxy = d3.sum(rows, d => (d[xKey] - mx) * (d[yKey] - my));
    const sxx = d3.sum(rows, d => (d[xKey] - mx) ** 2);
    const syy = d3.sum(rows, d => (d[yKey] - my) ** 2);
    return sxy / Math.sqrt(sxx * syy);
}


function init(data) {
    data.sort((a, b) => d3.ascending(a.rank, b.rank));

    // Best and worst rank a country could hold among the countries whose
    // confidence intervals overlap its own.
    data.forEach(d => {
        d.rankLow = 1 + data.filter(o => o.ci_low > d.ci_high).length;
        d.rankHigh = data.length - data.filter(o => o.ci_high < d.ci_low).length;
    });

    const byCountry = new Map(data.map(d => [d.country, d]));
    // Regions ordered from highest to lowest median life evaluation.
    const regionMedian = d3.rollup(data, v => d3.median(v, d => d.score), d => d.region);
    const regions = Array.from(regionMedian.keys())
        .sort((a, b) => d3.descending(regionMedian.get(a), regionMedian.get(b)));

    // d3.median skips the null cells.
    const medianOf = new Map(MEASURES.map(m => [m.key, d3.median(data, d => d[m.key])]));

    const state = {
        arrange: "global",   // "global" | "region"
        region: "All",
        measure: FACTORS[0],
        sharedAxis: true,    // one x-axis for all six factors
        selected: null,
        hovered: null,
    };


    // ---------------------------------------------------------------------
    // Controls
    // ---------------------------------------------------------------------

    d3.select("#country-list")
        .selectAll("option")
        .data(data.map(d => d.country).sort(d3.ascending))
        .join("option")
        .attr("value", d => d);

    const regionSelect = d3.select("#region-select");
    regionSelect.selectAll("option")
        .data(["All", ...regions])
        .join("option")
        .attr("value", d => d)
        .text(d => d === "All" ? "All regions" : d);

    d3.select("#measure-select")
        .selectAll("option")
        .data(MEASURES)
        .join("option")
        .attr("value", d => d.key)
        .text(d => d.label);

    const searchInput = d3.select("#country-search");

    searchInput.on("change", function () {
        const query = this.value.trim().toLowerCase();
        if (!query) return;
        const match = data.find(d => d.country.toLowerCase() === query)
            || data.find(d => d.country.toLowerCase().startsWith(query));
        d3.select("#search-note").text(match ? "" : "No country with that name.");
        if (!match) return;

        // A region filter that hides the match would make the search look broken.
        if (state.region !== "All" && state.region !== match.region) {
            state.region = "All";
            regionSelect.property("value", "All");
            renderDotPlot();
            renderScatter();
        }
        select(match, true);
    });

    regionSelect.on("change", function () {
        state.region = this.value;
        renderDotPlot();
        renderScatter();
        updateHighlight();
    });

    d3.selectAll("input[name=arrange]").on("change", function () {
        state.arrange = this.value;
        renderDotPlot();
        updateHighlight();
    });

    d3.select("#measure-select").on("change", function () {
        state.measure = MEASURES.find(m => m.key === this.value);
        renderScatter();
        updateHighlight();
    });

    d3.select("#shared-axis").on("change", function () {
        state.sharedAxis = this.checked;
        renderScatter();
        updateHighlight();
    });

    d3.select("#clear-selection").on("click", () => select(null));


    // ---------------------------------------------------------------------
    // Dot plot
    // ---------------------------------------------------------------------

    const xScore = d3.scaleLinear()
        .domain(SCORE_DOMAIN)
        .range([DOT_M.left, DOT_W - DOT_M.right]);

    const scoreTicks = xScore.ticks(7);

    // Column headings and the score axis live in their own small SVG so that
    // CSS can keep them in view while the long list scrolls underneath.
    const axisSvg = d3.select("#dot-axis")
        .append("svg")
        .attr("viewBox", `0 0 ${DOT_W} ${AXIS_H}`)
        .attr("class", "whr-svg");

    axisSvg.append("text").attr("class", "whr-col-head")
        .attr("x", RANK_X).attr("y", AXIS_H - 8).attr("text-anchor", "end")
        .text("Rank range");
    axisSvg.append("text").attr("class", "whr-col-head")
        .attr("x", NAME_X).attr("y", AXIS_H - 8)
        .text("Country");
    axisSvg.append("text").attr("class", "whr-col-head")
        .attr("x", DOT_W - 4).attr("y", AXIS_H - 8).attr("text-anchor", "end")
        .text("Score");
    axisSvg.append("text").attr("class", "whr-axis-title")
        .attr("x", DOT_M.left).attr("y", 12)
        .text("Average life evaluation (0–10 ladder), 2023–2025");
    axisSvg.append("g")
        .attr("class", "whr-axis")
        .attr("transform", `translate(0,${AXIS_H - 1})`)
        .call(d3.axisTop(xScore).tickValues(scoreTicks).tickSize(4).tickPadding(3))
        .call(g => g.select(".domain").remove());

    const dotSvg = d3.select("#dot-plot")
        .append("svg")
        .attr("class", "whr-svg")
        .attr("role", "img")
        .attr("aria-label", "Dot plot of average life evaluation with 95% confidence intervals for 147 countries");

    const gridLayer = dotSvg.append("g");
    const bandRect = dotSvg.append("rect").attr("class", "whr-band").attr("y", 0);
    const headerLayer = dotSvg.append("g");
    const rowLayer = dotSvg.append("g");

    function layoutRows() {
        const visible = state.region === "All"
            ? data
            : data.filter(d => d.region === state.region);
        const headers = [];
        let y = 4;

        if (state.arrange === "region") {
            regions.forEach(region => {
                const rows = visible.filter(d => d.region === region);
                if (!rows.length) return;
                headers.push({
                    region,
                    y,
                    count: rows.length,
                    median: d3.median(rows, d => d.score),
                    height: rows.length * ROW_H,
                });
                y += HEADER_H;
                rows.forEach(d => { d.y = y; y += ROW_H; });
                y += BLOCK_GAP;
            });
        } else {
            visible.forEach(d => { d.y = y; y += ROW_H; });
        }

        return { visible, headers, height: y + 6 };
    }

    function renderDotPlot() {
        const { visible, headers, height } = layoutRows();

        dotSvg.attr("viewBox", `0 0 ${DOT_W} ${height}`);
        bandRect.attr("height", height);

        gridLayer.selectAll("line")
            .data(scoreTicks)
            .join("line")
            .attr("class", "whr-grid")
            .attr("x1", d => xScore(d))
            .attr("x2", d => xScore(d))
            .attr("y1", 0)
            .attr("y2", height);

        // Region headings with the regional median drawn through the block.
        const header = headerLayer.selectAll("g.whr-header")
            .data(headers, d => d.region)
            .join(enter => {
                const g = enter.append("g").attr("class", "whr-header");
                g.append("rect").attr("class", "whr-header-bg")
                    .attr("x", 0).attr("width", DOT_W).attr("height", HEADER_H - 8);
                g.append("text").attr("class", "whr-region-name").attr("x", 6).attr("y", 15);
                g.append("line").attr("class", "whr-median-line");
                g.append("text").attr("class", "whr-median-label").attr("y", 15);
                return g;
            })
            .attr("transform", d => `translate(0,${d.y})`);

        header.select(".whr-region-name")
            .text(d => `${d.region} · ${d.count} ${d.count === 1 ? "country" : "countries"}`);
        header.select(".whr-median-line")
            .attr("x1", d => xScore(d.median))
            .attr("x2", d => xScore(d.median))
            .attr("y1", HEADER_H - 8)
            .attr("y2", d => HEADER_H + d.height);
        header.select(".whr-median-label")
            .attr("x", d => xScore(d.median))
            .attr("text-anchor", "middle")
            .text(d => `median ${fmt2(d.median)}`);

        rowLayer.selectAll("g.whr-row")
            .data(visible, d => d.country)
            .join(
                enter => {
                    const g = enter.append("g")
                        .attr("class", "whr-row")
                        .attr("transform", d => `translate(0,${d.y})`);

                    g.append("rect").attr("class", "whr-row-hit")
                        .attr("width", DOT_W).attr("height", ROW_H);
                    g.append("text").attr("class", "whr-rank")
                        .attr("x", RANK_X).attr("y", ROW_H / 2).attr("dy", "0.35em")
                        .attr("text-anchor", "end")
                        .text(rankRangeText);
                    g.append("text").attr("class", "whr-name")
                        .attr("x", NAME_X).attr("y", ROW_H / 2).attr("dy", "0.35em")
                        .text(d => d.country);
                    g.append("line").attr("class", "whr-ci")
                        .attr("x1", d => xScore(d.ci_low))
                        .attr("x2", d => xScore(d.ci_high))
                        .attr("y1", ROW_H / 2).attr("y2", ROW_H / 2);
                    g.append("circle").attr("class", "whr-dot")
                        .attr("cx", d => xScore(d.score))
                        .attr("cy", ROW_H / 2)
                        .attr("r", 3);
                    g.append("text").attr("class", "whr-score")
                        .attr("x", DOT_W - 4).attr("y", ROW_H / 2).attr("dy", "0.35em")
                        .attr("text-anchor", "end")
                        .text(d => fmt2(d.score));

                    g.on("pointerenter", (event, d) => hover(d, event))
                        .on("pointermove", (event) => moveTooltip(event))
                        .on("pointerleave", () => hover(null))
                        .on("click", (event, d) => select(state.selected === d ? null : d));

                    return g;
                },
                update => update.call(u => u.transition().duration(MOVE_MS)
                    .attr("transform", d => `translate(0,${d.y})`)),
                exit => exit.remove()
            );
    }


    // ---------------------------------------------------------------------
    // Scatter plot: life evaluation against one factor
    // ---------------------------------------------------------------------

    const scatterSvg = d3.select("#scatter")
        .append("svg")
        .attr("viewBox", `0 0 ${SC_W} ${SC_H}`)
        .attr("class", "whr-svg")
        .attr("role", "img")
        .attr("aria-label", "Scatter plot of life evaluation against the selected factor");

    const yScore = d3.scaleLinear()
        .domain(SCORE_DOMAIN)
        .range([SC_H - SC_M.bottom, SC_M.top]);

    const xMeasure = d3.scaleLinear()
        .range([SC_M.left, SC_W - SC_M.right]);

    scatterSvg.append("g")
        .selectAll("line")
        .data(yScore.ticks(7))
        .join("line")
        .attr("class", "whr-grid")
        .attr("x1", SC_M.left).attr("x2", SC_W - SC_M.right)
        .attr("y1", d => yScore(d)).attr("y2", d => yScore(d));

    const scatterBand = scatterSvg.append("rect").attr("class", "whr-band")
        .attr("x", SC_M.left).attr("width", SC_W - SC_M.left - SC_M.right);
    const zeroLine = scatterSvg.append("line").attr("class", "whr-zero")
        .attr("y1", SC_M.top).attr("y2", SC_H - SC_M.bottom);

    scatterSvg.append("g")
        .attr("class", "whr-axis")
        .attr("transform", `translate(${SC_M.left},0)`)
        .call(d3.axisLeft(yScore).ticks(7).tickSize(4))
        .call(g => g.select(".domain").remove());
    const xAxisG = scatterSvg.append("g")
        .attr("class", "whr-axis")
        .attr("transform", `translate(0,${SC_H - SC_M.bottom})`);

    scatterSvg.append("text").attr("class", "whr-axis-title")
        .attr("x", SC_M.left).attr("y", 9)
        .text("Life evaluation");
    const xTitle = scatterSvg.append("text").attr("class", "whr-axis-title")
        .attr("x", SC_W - SC_M.right).attr("y", SC_H - 6)
        .attr("text-anchor", "end");

    const pointLayer = scatterSvg.append("g");
    const markLayer = scatterSvg.append("g").attr("class", "whr-marks");

    let delaunay = null;
    let plotted = [];

    scatterSvg.append("rect").attr("class", "whr-hit")
        .attr("x", SC_M.left).attr("y", SC_M.top)
        .attr("width", SC_W - SC_M.left - SC_M.right)
        .attr("height", SC_H - SC_M.top - SC_M.bottom)
        // The pointer only has to be closest to a dot, not on it.
        .on("pointermove", event => {
            const [px, py] = d3.pointer(event);
            const d = plotted[delaunay.find(px, py)];
            const near = d && Math.hypot(
                xMeasure(d[state.measure.key]) - px, yScore(d.score) - py) < HOVER_RADIUS;
            hover(near ? d : null, event);
        })
        .on("pointerleave", () => hover(null))
        .on("click", () => {
            if (state.hovered) select(state.selected === state.hovered ? null : state.hovered);
        });

    function renderScatter() {
        const key = state.measure.key;
        const isResidual = key === RESIDUAL.key;

        plotted = data.filter(d => d[key] !== null);

        // The shared axis keeps the six factors comparable in size; zooming
        // trades that for a clearer view of one factor's relationship.
        if (isResidual) xMeasure.domain(RESIDUAL_DOMAIN);
        else if (state.sharedAxis) xMeasure.domain(FACTOR_DOMAIN);
        else xMeasure.domain([0, d3.max(plotted, d => d[key])]).nice();
        d3.select("#shared-axis").property("disabled", isResidual);
        delaunay = d3.Delaunay.from(plotted, d => xMeasure(d[key]), d => yScore(d.score));

        xAxisG.call(d3.axisBottom(xMeasure).ticks(8).tickSize(4)
            .tickFormat(isResidual ? fmtSignedTick : null))
            .call(g => g.select(".domain").remove());

        xTitle.text(isResidual
            ? "Actual minus predicted life evaluation (ladder points)"
            : `Ladder points explained by ${state.measure.label.toLowerCase()
                .replace("gdp", "GDP")}`);

        zeroLine
            .attr("x1", xMeasure(0)).attr("x2", xMeasure(0))
            .classed("is-strong", isResidual);

        const inRegion = d => state.region === "All" || d.region === state.region;

        pointLayer.selectAll("circle")
            // Draw the filtered-out countries first so they sit underneath.
            .data(d3.sort(plotted, d => inRegion(d) ? 1 : 0), d => d.country)
            .join(enter => enter.append("circle")
                .attr("class", "whr-point")
                .attr("r", 4)
                .attr("cx", d => xMeasure(d[key]))
                .attr("cy", d => yScore(d.score)))
            .order()
            .classed("is-out", d => !inRegion(d))
            .transition().duration(MOVE_MS)
            .attr("cx", d => xMeasure(d[key]));

        const shown = plotted.filter(inRegion);
        const r = pearson(shown, key, "score");
        const scope = state.region === "All" ? "all regions" : state.region;
        d3.select("#scatter-note").text(
            `Correlation with life evaluation: r = ${fmt2(r)} `
            + `(${shown.length} countries, ${scope}). `
            + (isResidual
                ? "Right of zero: happier than the six factors predict; left: less happy."
                : state.sharedAxis
                    ? "All six factors share this axis, so a narrow cloud means a factor that explains little."
                    : "Axis zoomed to this factor: widths are no longer comparable across factors.")
        );
    }


    // ---------------------------------------------------------------------
    // Profile of the selected country
    // ---------------------------------------------------------------------

    const profileHeight = PR_M.top + MEASURES.length * PR_ROW_H + 8 + PR_M.bottom;

    const profileSvg = d3.select("#profile")
        .append("svg")
        .attr("viewBox", `0 0 ${PR_W} ${profileHeight}`)
        .attr("class", "whr-svg");

    const xProfile = d3.scaleLinear()
        .domain(PROFILE_DOMAIN)
        .range([PR_M.left, PR_W - PR_M.right]);

    // The residual sits apart from the six factors: it is not a factor.
    const profileY = (m, i) => PR_M.top + i * PR_ROW_H + (m === RESIDUAL ? 8 : 0);

    profileSvg.append("g")
        .attr("class", "whr-axis")
        .attr("transform", `translate(0,${PR_M.top - 4})`)
        .call(d3.axisTop(xProfile).ticks(8).tickSize(3).tickFormat(fmtSignedTick))
        .call(g => g.select(".domain").remove());

    profileSvg.append("line").attr("class", "whr-zero is-strong")
        .attr("x1", xProfile(0)).attr("x2", xProfile(0))
        .attr("y1", PR_M.top - 4).attr("y2", profileHeight - PR_M.bottom);

    profileSvg.append("line").attr("class", "whr-grid")
        .attr("x1", 0).attr("x2", PR_W)
        .attr("y1", profileY(RESIDUAL, FACTORS.length) - 3)
        .attr("y2", profileY(RESIDUAL, FACTORS.length) - 3);

    const profileRow = profileSvg.selectAll("g.whr-profile-row")
        .data(MEASURES)
        .join("g")
        .attr("class", "whr-profile-row")
        .classed("is-residual", d => d === RESIDUAL)
        .attr("transform", (d, i) => `translate(0,${profileY(d, i)})`);

    profileRow.append("text").attr("class", "whr-profile-label")
        .attr("x", PR_M.left - 8).attr("y", PR_ROW_H / 2).attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .text(d => d === RESIDUAL ? "Unexplained (residual)" : d.label);
    profileRow.append("rect").attr("class", "whr-profile-bar")
        .attr("y", (PR_ROW_H - 10) / 2).attr("height", 10)
        .attr("x", xProfile(0)).attr("width", 0);
    profileRow.append("line").attr("class", "whr-profile-median")
        .attr("x1", d => xProfile(medianOf.get(d.key)))
        .attr("x2", d => xProfile(medianOf.get(d.key)))
        .attr("y1", 2).attr("y2", PR_ROW_H - 2);
    // Values sit in a column at the right so they never collide with a bar.
    profileRow.append("text").attr("class", "whr-profile-value")
        .attr("x", PR_W - 4).attr("y", PR_ROW_H / 2).attr("dy", "0.35em")
        .attr("text-anchor", "end");

    function renderProfile() {
        const d = state.selected;

        d3.select("#profile-title")
            .text(d ? `Factor profile: ${d.country}` : "Factor profile");
        d3.select("#profile").style("display", d ? null : "none");
        d3.select("#profile-legend").style("display", d ? null : "none");

        const summary = d3.select("#profile-summary");
        if (!d) {
            summary.text("Click a country in either chart, or search for one, to see its six "
                + "factors side by side.");
            return;
        }

        const missing = FACTORS.filter(m => d[m.key] === null);
        if (missing.length) {
            summary.text(`The source data has no value for ${missing.map(m => m.label.toLowerCase()).join(" or ")} `
                + `in ${d.country}, so its predicted score and residual cannot be computed.`);
        } else {
            const predicted = DYSTOPIA + d3.sum(FACTORS, m => d[m.key]);
            summary.text(`Predicted from the six factors: ${fmt2(predicted)}. `
                + `Actual: ${fmt2(d.score)}. Residual: ${fmtSigned(d.residual)}.`);
        }

        profileRow.select(".whr-profile-bar")
            .transition().duration(MOVE_MS / 2)
            .attr("x", m => xProfile(Math.min(0, d[m.key] ?? 0)))
            .attr("width", m => Math.abs(xProfile(d[m.key] ?? 0) - xProfile(0)));

        profileRow.select(".whr-profile-value")
            .text(m => d[m.key] === null
                ? "n/a"
                : m === RESIDUAL ? fmtSigned(d[m.key]) : fmt2(d[m.key]));
    }


    // ---------------------------------------------------------------------
    // Linked highlighting
    // ---------------------------------------------------------------------

    function select(d, scroll = false) {
        state.selected = d;
        searchInput.property("value", d ? d.country : "");
        d3.select("#search-note").text("");
        renderProfile();
        updateHighlight();

        if (d && scroll) {
            rowLayer.selectAll("g.whr-row")
                .filter(r => r === d)
                .each(function () {
                    this.scrollIntoView({ behavior: "smooth", block: "center" });
                });
        }
    }

    function hover(d, event) {
        state.hovered = d;
        updateHighlight();

        if (!d) {
            tooltip.style("opacity", 0);
            return;
        }

        tooltip.selectAll("*").remove();
        tooltip.append("strong").text(d.country);
        tooltip.append("div").attr("class", "whr-tip-muted").text(d.region);
        tooltip.append("div").text(
            `Life evaluation ${fmt2(d.score)} (95% CI ${fmt2(d.ci_low)}–${fmt2(d.ci_high)})`);
        tooltip.append("div").text(d.rankLow === d.rankHigh
            ? `Rank ${d.rank}, clearly separated from every other country`
            : `Rank ${d.rank}, not separable from ranks ${rankRangeText(d)}`);
        const value = d[state.measure.key];
        const measureName = state.measure === RESIDUAL ? "Residual" : state.measure.label;
        tooltip.append("div").text(value === null
            ? `${measureName}: not available`
            : `${measureName}: ${state.measure === RESIDUAL ? fmtSigned(value) : fmt2(value)}`);

        tooltip.style("opacity", 1);
        moveTooltip(event);
    }

    function moveTooltip(event) {
        if (!event) return;
        const flip = event.clientX > window.innerWidth - 320;
        tooltip
            .style("left", flip ? null : `${event.pageX + 14}px`)
            .style("right", flip ? `${document.documentElement.clientWidth - event.pageX + 14}px` : null)
            .style("top", `${event.pageY + 14}px`);
    }

    function updateHighlight() {
        const sel = state.selected;
        const hov = state.hovered;

        rowLayer.selectAll("g.whr-row")
            .classed("is-selected", d => d === sel)
            .classed("is-hover", d => d === hov)
            .classed("is-dim", d => sel !== null && !overlaps(d, sel));

        // The band marks the selected country's interval in both charts: any
        // interval (dot plot) or dot (scatter) touching it cannot be separated.
        bandRect
            .style("display", sel ? null : "none")
            .attr("x", sel ? xScore(sel.ci_low) : 0)
            .attr("width", sel ? xScore(sel.ci_high) - xScore(sel.ci_low) : 0);
        scatterBand
            .style("display", sel ? null : "none")
            .attr("y", sel ? yScore(sel.ci_high) : 0)
            .attr("height", sel ? yScore(sel.ci_low) - yScore(sel.ci_high) : 0);

        const key = state.measure.key;
        const marked = [sel, hov]
            .filter((d, i, all) => d && d[key] !== null && all.indexOf(d) === i);

        const mark = markLayer.selectAll("g.whr-mark")
            .data(marked, d => d.country)
            .join(enter => {
                const g = enter.append("g").attr("class", "whr-mark");
                g.append("circle").attr("r", 6);
                g.append("text").attr("dy", "0.35em");
                return g;
            })
            .classed("is-selected", d => d === sel)
            .attr("transform", d => `translate(${xMeasure(d[key])},${yScore(d.score)})`);

        // Labels flip to the left near the right edge so they stay inside.
        mark.select("text")
            .attr("x", d => xMeasure(d[key]) > SC_W * 0.7 ? -10 : 10)
            .attr("text-anchor", d => xMeasure(d[key]) > SC_W * 0.7 ? "end" : "start")
            .text(d => d.country);

        d3.select("#clear-selection").property("disabled", sel === null);
        d3.select("#selection-note").text(sel === null
            ? ""
            : sel.rankLow === sel.rankHigh
                ? `${sel.country}: no other country's interval overlaps it.`
                : `${sel.country}: ${sel.rankHigh - sel.rankLow} other `
                    + `${sel.rankHigh - sel.rankLow === 1 ? "country has an" : "countries have"} overlapping `
                    + `${sel.rankHigh - sel.rankLow === 1 ? "interval" : "intervals"} `
                    + `(ranks ${rankRangeText(sel)}). The rest are faded.`);
    }


    renderDotPlot();
    renderScatter();
    renderProfile();
    updateHighlight();
}
