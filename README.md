# 🌿 Towards Carbon-Neutral Campuses: UAV × Satellite × ML

> **Vegetation carbon stock estimation and photovoltaic potential 
> assessment at Wenzhou-Kean University, China**

[![Status](https://img.shields.io/badge/Status-In_Preparation-yellow)](.)
[![Journal](https://img.shields.io/badge/Target-Sustainable_Cities_%26_Society-blue)](https://www.sciencedirect.com/journal/sustainable-cities-and-society)
[![GEE](https://img.shields.io/badge/Platform-Google_Earth_Engine-green)](https://earthengine.google.com)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)

---

## 🎯 Key Finding

> **PV deployment on existing rooftops (90,257 m²) could offset 
> 8,023 tCO₂/yr — exceeding campus annual emissions of 8,352 tCO₂. 
> Combined with vegetation carbon stocks (3,617 tCO₂), WKU can 
> achieve carbon-positive status through integrated nature-based 
> and technological solutions.**

---

## 📊 Results at a Glance

| Metric | Value |
|--------|-------|
| Campus area | 376 ha |
| Forest cover (NDVI > 0.4) | 265 ha (70.5%) |
| Vegetation carbon stock | **3,617 tCO₂** |
| Annual campus emissions (2024) | 8,352 tCO₂ |
| Carbon offset ratio (vegetation only) | 43% |
| Rooftop PV potential (ArcGIS-verified) | 90,257 m² |
| PV annual energy generation | 13,809 MWh/yr |
| PV CO₂ offset | **8,023 tCO₂/yr** |
| **Combined offset** | **11,640 tCO₂ > 8,352 tCO₂** ✅ |
| RF model RMSE | 11.14 m |
| GEDI training samples | 156 footprints |

---

## 🔬 Methodology Overview

```text
UAV Photogrammetry          Satellite Data              Field Surveys
(DJI Mavic 2/3 Pro)        (Sentinel-1/2, GEDI)        (DBH, Height)
1.2 cm/pixel ortho          GEE Processing               Allometrics
↓                          ↓                          ↓
SfM-MVS 3D               Random Forest RF              AGB → Carbon
Reconstruction            Canopy Height Model           (3,617 tCO₂)
↓                          ↓
QGIS Visual              Extended woodland
Interpretation            CHM prediction
(trees/shrubs/lawn)
↓
Integrated Carbon Balance
+ ArcGIS Rooftop PV Analysis
→ Net-zero pathway assessment
```

---

## 🗂️ Repository Structure

| Folder | Contents |
|--------|----------|
| `gee_scripts/` | Complete GEE workflow (v3.0) — GEDI + RF + PV scenarios |
| `r_analysis/` | Publication-quality figures (ggplot2) |
| `data/` | Summary results tables (CSV) |
| `arcgis_analysis/` | Rooftop digitisation methodology |
| `figures/` | All publication figures |

---

## 🛰️ Data Sources

| Dataset | Source | Resolution | Use |
|---------|--------|-----------|-----|
| Sentinel-2 SR | ESA Copernicus | 10–20 m | Spectral features, NDVI |
| Sentinel-1 GRD | ESA Copernicus | 10 m | SAR backscatter (VV/VH) |
| GEDI L2A | NASA | ~25 m footprint | Canopy height labels (RH98) |
| SRTM DEM | USGS | 30 m | Elevation, slope, aspect |
| UAV imagery | DJI Mavic 2/3 | 1.2 cm/px | On-campus structure |
| Campus emissions | WKU Sustainability Report | — | Carbon accounting |

---

## 🌱 PV Scenario Analysis

| Scenario | Roof Area | Usable | Energy | CO₂ Offset |
|----------|-----------|--------|--------|-----------|
| **A — Current (ArcGIS)** | 90,257 m² | 67,693 m² | **13,809 MWh/yr** | **8,023 tCO₂/yr** |
| B — Full buildout | 93,793 m² | 70,345 m² | 14,350 MWh/yr | 8,338 tCO₂/yr |
| C — Conservative (50%) | 90,257 m² | 45,129 m² | 9,206 MWh/yr | 5,349 tCO₂/yr |

*Assumptions: GHI = 1,200 kWh/m²/yr; panel efficiency = 20%; system efficiency = 85%; grid factor = 0.581 kgCO₂/kWh (China Eastern Grid 2021)*

---

## 🌿 Carbon Stock by Land Use

| Land Use | Area (m²) | Carbon Storage (tCO₂) | % of Total |
|----------|-----------|----------------------|------------|
| Woodland (Educational Reserve) | 877,522 | **1,878.9** | 51.9% |
| University Campus | 876,260 | 973.7 | 26.9% |
| Business District | 157,562 | 301.6 | 8.3% |
| Green Space | 93,710 | 200.6 | 5.5% |
| Other zones | ~700,939 | 262.5 | 7.3% |
| **Total** | **2,705,993** | **3,617.3** | **100%** |

---

## 🔍 Known Limitations

The Random Forest model achieved RMSE = 11.14 m and R² = 0.153 against 
GEDI RH98 labels. This low R² reflects the challenge of predicting 
subtropical urban-edge canopy height from satellite spectral features 
alone with sparse training data (n=156). Campus interior vegetation 
carbon was estimated directly from UAV-derived structural parameters 
and allometric equations, which does not depend on the RF model.

**Uncertainty sources:**
- Allometric equation transferability across species
- Temporal mismatch: UAV (2024) vs GEDI (2019–2024) vs Sentinel (2021)
- Shadow and mixed-pixel effects in UAV visual interpretation
- Roof-PV obstruction assumptions (75% usable fraction)

---

## 📬 Contact

**Wanru Gao** | wanrugao21@gmail.com  
BSc Environmental Science, University of Nottingham  
[LinkedIn](https://linkedin.com/in/wanru-gao-9581672b9) · 
[Peatland Repository](../peatland-flow-country-gee)

---

*Manuscript in preparation for **Sustainable Cities and Society***  
*Abstracts accepted: XJTLU-UNNC Conference 2026 · PolyU GeoAI Symposium 2026*
