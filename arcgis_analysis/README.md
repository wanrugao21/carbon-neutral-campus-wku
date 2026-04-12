# Rooftop Digitisation — ArcGIS Pro Methodology

## Overview
Campus rooftop area for PV potential assessment was quantified through 
manual digitisation in Google Earth Pro followed by area calculation 
in ArcGIS Pro — a more accurate approach than GEE spectral methods 
for this complex urban campus environment.

## Method

### Step 1: Google Earth Pro (Digitisation)
- Imported high-resolution satellite imagery (2024 vintage)
- Manually digitised all rooftop polygons across the WKU campus built-up area
- Polygons drawn for: academic buildings, residential blocks, service facilities
- Excluded: skylights, HVAC units, mechanical rooms (visually identified)

### Step 2: ArcGIS Pro (Area Calculation)
- Imported KML polygons from Google Earth Pro
- Re-projected to UTM Zone 50N (EPSG:32650) for metric accuracy
- Used Calculate Geometry tool: area in square metres
- Applied 75% usability factor (industry standard for obstructions/setbacks)

## Results
| Metric | Value |
|--------|-------|
| Total digitised roof area | **90,257.07 m²** |
| Usable area (75%) | 67,693 m² |
| GEE estimate (comparison) | 105,885 m² (+17.3% overestimate) |

## Why GEE Overestimates
GEE's NDBI + slope + NDVI threshold approach misclassifies:
- Paved plazas and pathways (low NDVI, flat)
- Bare soil construction areas
- Reflective sports courts

Manual digitisation is recommended as the primary method for 
campus-scale rooftop PV assessment.
