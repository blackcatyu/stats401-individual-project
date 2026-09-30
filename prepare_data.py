"""
STATS 401 - Visualization Critique and Redesign: data preparation

Turns the spreadsheet behind Figure 2.1 of the World Happiness Report 2026
into the tidy CSV that redesign.js loads with d3.csv().

Steps:
  1. keep the 2025 rows (the 2023-2025 average that Figure 2.1 shows);
  2. rename the columns to short names;
  3. split the "Dystopia + residual" column into its two parts by removing
     the Dystopia constant (1.16), leaving each country's own residual;
  4. add a world region to every country.

Raw data: WHR26_Data_Figure_2.1.xlsx ("Data for Figure 2.1"), downloaded
from https://worldhappiness.report/data-sharing/

Regions: World Bank regional classification
(https://datahelpdesk.worldbank.org/knowledgebase/articles/906519), using the
seven-region grouping in which Afghanistan and Pakistan belong to South Asia.
"Taiwan Province of China" is not in the World Bank list and is placed in
East Asia & Pacific by hand; "State of Palestine" is the World Bank's
"West Bank and Gaza".

Run from the project folder:
    python prepare_data.py

Requires: pandas, openpyxl
"""

import os

import pandas as pd

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_PATH = os.path.join(SCRIPT_DIR, "WHR26_Data_Figure_2.1.xlsx")
CLEAN_PATH = os.path.join(SCRIPT_DIR, "data", "whr26_2025.csv")

YEAR = 2025
DYSTOPIA = 1.16  # life evaluation of the benchmark country, from the figure legend

COLUMNS = {
    "Rank": "rank",
    "Country name": "country",
    "Life evaluation (3-year average)": "score",
    "Lower whisker": "ci_low",
    "Upper whisker": "ci_high",
    "Explained by: Log GDP per capita": "gdp",
    "Explained by: Social support": "social",
    "Explained by: Healthy life expectancy": "health",
    "Explained by: Freedom to make life choices": "freedom",
    "Explained by: Generosity": "generosity",
    "Explained by: Perceptions of corruption": "corruption",
    "Dystopia + residual": "dystopia_residual",
}

REGIONS = {
    "East Asia & Pacific": [
        "New Zealand", "Australia", "Taiwan Province of China", "Singapore",
        "Viet Nam", "Thailand", "Philippines", "Japan", "China",
        "Republic of Korea", "Malaysia", "Mongolia", "Indonesia",
        "Hong Kong SAR of China", "Lao PDR", "Cambodia", "Myanmar",
    ],
    "Europe & Central Asia": [
        "Finland", "Iceland", "Denmark", "Sweden", "Norway", "Netherlands",
        "Luxembourg", "Switzerland", "Ireland", "Belgium", "Kosovo", "Germany",
        "Slovenia", "Austria", "Czechia", "Poland", "Lithuania",
        "United Kingdom", "Serbia", "Kazakhstan", "Romania", "France", "Italy",
        "Spain", "Estonia", "Bosnia and Herzegovina", "Latvia", "Uzbekistan",
        "Slovakia", "Montenegro", "Cyprus", "Kyrgyzstan", "Portugal",
        "Croatia", "Hungary", "Republic of Moldova", "Russian Federation",
        "North Macedonia", "Bulgaria", "Greece", "Albania", "Tajikistan",
        "Armenia", "Georgia", "Türkiye", "Azerbaijan", "Ukraine",
    ],
    "Latin America & Caribbean": [
        "Costa Rica", "Mexico", "Belize", "Uruguay", "Brazil", "El Salvador",
        "Panama", "Guatemala", "Argentina", "Jamaica", "Chile", "Nicaragua",
        "Paraguay", "Ecuador", "Honduras", "Dominican Republic", "Colombia",
        "Peru", "Trinidad and Tobago", "Bolivia", "Venezuela",
    ],
    "Middle East & North Africa": [
        "Israel", "United Arab Emirates", "Saudi Arabia", "Kuwait", "Malta",
        "Bahrain", "Oman", "Libya", "Algeria", "Iraq", "Iran", "Tunisia",
        "State of Palestine", "Morocco", "Jordan", "Egypt", "Lebanon", "Yemen",
    ],
    "North America": [
        "United States", "Canada",
    ],
    "South Asia": [
        "Nepal", "Pakistan", "India", "Bangladesh", "Sri Lanka", "Afghanistan",
    ],
    "Sub-Saharan Africa": [
        "Mauritius", "Mozambique", "Gabon", "Côte d’Ivoire", "Cameroon",
        "South Africa", "Niger", "Nigeria", "Senegal", "Namibia", "Kenya",
        "Guinea", "Mali", "Ghana", "Somalia", "Uganda", "Mauritania", "Congo",
        "Burkina Faso", "Benin", "Chad", "Lesotho", "Gambia", "Liberia",
        "Togo", "Madagascar", "Zambia", "Ethiopia", "Comoros", "Eswatini",
        "Tanzania", "DR Congo", "Botswana", "Zimbabwe", "Malawi",
        "Sierra Leone",
    ],
}

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------

raw = pd.read_excel(RAW_PATH)

clean = (
    raw[raw["Year"] == YEAR]
    .rename(columns=COLUMNS)[list(COLUMNS.values())]
    .sort_values("rank")
    .reset_index(drop=True)
)

# Two countries lack one factor each, so the source gives them no
# "Dystopia + residual" value and their residual stays empty.
clean["residual"] = (clean["dystopia_residual"] - DYSTOPIA).round(3)
clean = clean.drop(columns="dystopia_residual")

region_of = {
    country: region
    for region, countries in REGIONS.items()
    for country in countries
}
clean.insert(2, "region", clean["country"].map(region_of))

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

unmatched = clean.loc[clean["region"].isna(), "country"].tolist()
assert not unmatched, f"Countries without a region: {unmatched}"

unused = sorted(set(region_of) - set(clean["country"]))
assert not unused, f"Region entries that match no country: {unused}"

# Dystopia + the six factors + the residual should rebuild the score.
factors = ["gdp", "social", "health", "freedom", "generosity", "corruption"]
complete = clean.dropna(subset=["residual"])
rebuilt = DYSTOPIA + complete[factors].sum(axis=1) + complete["residual"]
assert (rebuilt - complete["score"]).abs().max() < 0.005

# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

clean.to_csv(CLEAN_PATH, index=False, encoding="utf-8")

print(f"Wrote {len(clean)} countries to {os.path.relpath(CLEAN_PATH, SCRIPT_DIR)}")
print(f"Without a complete factor breakdown: {len(clean) - len(complete)}")
print(clean["region"].value_counts().to_string())
