// ============================================================
// Carbon-Neutral Campus — WKU Wenzhou, China
// GEE Code v3.0
// Author: Wanru Gao, University of Nottingham
// Updates: Extended GEDI to 2024, PV scenario analysis added,
//          all publication figure exports included
// ============================================================

// ============================================================
// 1. STUDY AREA DEFINITION
// ============================================================
// Campus prediction region
var campusRegion = ee.Geometry.Rectangle([120.64, 27.915, 120.663, 27.93]);

// Extended region for GEDI training (20km buffer — critical fix)
var extendedRegion = campusRegion.buffer(20000);

Map.centerObject(campusRegion, 15);
Map.addLayer(campusRegion, {color: 'red'}, '01_Campus Boundary');

// Print campus area for paper
var campusAreaCalc = ee.Image.pixelArea()
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: campusRegion,
    scale: 10,
    maxPixels: 1e9
  });
print('Campus area (m²):', campusAreaCalc);

// ============================================================
// 2. TIME PERIOD
// Using 2021 to match GEDI data availability
// ============================================================
var startDate = '2021-04-01';
var endDate   = '2021-10-31';  // Growing season in subtropical Wenzhou

// ============================================================
// 3. SENTINEL-2 PREPROCESSING
// SCL-based cloud masking (more reliable than CLOUDY_PIXEL)
// ============================================================
function maskS2Clouds(image) {
  var scl = image.select('SCL');
  // Keep: vegetation(4), bare soil(5), water(6)
  // Exclude: cloud shadow(3), cloud medium(8), cloud high(9), cirrus(10)
  var valid = scl.eq(4).or(scl.eq(5)).or(scl.eq(6));
  return image.updateMask(valid).divide(10000)
              .copyProperties(image, ['system:time_start']);
}

// Extended region composite (for RF training)
var s2Ext = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(extendedRegion)
  .filterDate(startDate, endDate)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2Clouds)
  .select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'])
  .median()
  .clip(extendedRegion);

// Campus region composite (for final prediction)
var s2Cam = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(campusRegion)
  .filterDate(startDate, endDate)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2Clouds)
  .select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'])
  .median()
  .clip(campusRegion);

print('S2 campus scene count:', 
  ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(campusRegion)
    .filterDate(startDate, endDate)
    .size());

// ============================================================
// 4. SENTINEL-1 PREPROCESSING
// ============================================================
function getS1(region) {
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(region)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH'])
    .median()
    .clip(region);
}

var s1Ext = getS1(extendedRegion);
var s1Cam = getS1(campusRegion);

print('S1 campus bands:', s1Cam.bandNames());

// ============================================================
// 5. TERRAIN VARIABLES (SRTM 30m)
// ============================================================
var srtm = ee.Image('USGS/SRTMGL1_003');

var elevExt  = srtm.clip(extendedRegion).rename('Elevation');
var slopeExt = ee.Terrain.slope(srtm).clip(extendedRegion).rename('Slope');
var aspExt   = ee.Terrain.aspect(srtm).clip(extendedRegion).rename('Aspect');

var elevCam  = srtm.clip(campusRegion).rename('Elevation');
var slopeCam = ee.Terrain.slope(srtm).clip(campusRegion).rename('Slope');
var aspCam   = ee.Terrain.aspect(srtm).clip(campusRegion).rename('Aspect');

// ============================================================
// 6. FEATURE ENGINEERING — 21 variables
// Spectral(10) + SAR(2) + Indices(6) + Terrain(3)
// ============================================================
function buildFeatures(s2, s1, elev, slope, aspect) {
  // Vegetation indices
  var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = s2.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndbi = s2.normalizedDifference(['B11','B8']).rename('NDBI');  // KEY: building index
  var evi  = s2.expression(
    '2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))',
    {NIR:s2.select('B8'), RED:s2.select('B4'), BLUE:s2.select('B2')}
  ).rename('EVI');
  var ndre = s2.normalizedDifference(['B8','B5']).rename('NDRE');  // Red-edge
  // SAR cross-pol difference
  var vvvh = s1.select('VV').subtract(s1.select('VH')).rename('VV_VH_diff');

  return s2.select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'])
    .addBands(s1.select(['VV','VH']))
    .addBands([ndvi, ndwi, ndbi, evi, ndre, vvvh])
    .addBands([elev, slope, aspect]);
}

var featExt = buildFeatures(s2Ext, s1Ext, elevExt, slopeExt, aspExt);
var featCam = buildFeatures(s2Cam, s1Cam, elevCam, slopeCam, aspCam);

var featureBands = [
  'B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12',  // S2 spectral (10)
  'VV','VH',                                               // S1 SAR (2)
  'NDVI','NDWI','NDBI','EVI','NDRE','VV_VH_diff',         // Indices (6)
  'Elevation','Slope','Aspect'                             // Terrain (3)
];
print('Total feature count:', featureBands.length);

// ============================================================
// 7. FOREST MASK
// Combined: NDVI threshold + ESA WorldCover validation
// ============================================================
var ndviExt = s2Ext.normalizedDifference(['B8','B4']);
var ndviCam = s2Cam.normalizedDifference(['B8','B4']);

// Primary mask: NDVI > 0.4
var forestExt = ndviExt.gt(0.4);
var forestCam = ndviCam.gt(0.4);

// WorldCover validation layer (not used in masking, for reference)
var worldcover = ee.ImageCollection('ESA/WorldCover/v200').first()
                   .clip(campusRegion);
// WorldCover tree class = 10
var wcTreeMask = worldcover.eq(10);
Map.addLayer(wcTreeMask.selfMask(),
             {palette: ['darkgreen']}, '02_WorldCover Trees', false);

// ============================================================
// 8. GEDI L2A DATA — Extended temporal range 2019–2024
// Maximises footprint coverage over extended region
// ============================================================
var gediImage = ee.ImageCollection('LARSE/GEDI/GEDI02_A_002_MONTHLY')
  .filterDate('2019-04-01', '2024-06-30')
  .filterBounds(extendedRegion)
  .select('rh98')
  .mean()
  .clip(extendedRegion)
  .rename('label');

// Quality filter: realistic canopy height range, forest only
var gediValid = gediImage.gt(2).and(gediImage.lt(50)).and(forestExt);
var gediMasked = gediImage.updateMask(gediValid);

Map.addLayer(gediMasked,
  {min:2, max:40, palette:['#ffffcc','#78c679','#006837']},
  '03_GEDI RH98 (training labels)');
  
// GEDI coverage statistics
var gediCoverArea = gediMasked.gt(0).multiply(ee.Image.pixelArea())
  .reduceRegion({reducer: ee.Reducer.sum(),
                 geometry: extendedRegion, scale: 25, maxPixels: 1e10});
print('GEDI valid pixel area (m²):', gediCoverArea);

// ============================================================
// 9. TRAINING SAMPLE EXTRACTION
// Scale=25m matches GEDI footprint (~25m diameter)
// ============================================================
// Combine features with GEDI label
var trainingImage = featExt
  .updateMask(forestExt)
  .addBands(gediMasked);  // adds 'label' band

// Sample from extended region — should get 500-2000+ points
var allSamples = trainingImage.sample({
  region: extendedRegion,
  scale: 25,
  numPixels: 5000,
  seed: 42,
  geometries: true
}).filter(ee.Filter.notNull(['label']))
  .filter(ee.Filter.gt('label', 2))
  .filter(ee.Filter.lt('label', 50));

print('=== GEDI Sample Diagnostics ===');
print('Total valid samples (critical):', allSamples.size());

// GEDI height distribution statistics (for Methods table)
var gediStats = allSamples.aggregate_stats('label');
print('GEDI height stats (mean/min/max/sd):', gediStats);

// ============================================================
// 10. TRAIN/TEST SPLIT — 70/30 stratified random
// ============================================================
var withRnd = allSamples.randomColumn('rnd', 42);
var trainSet = withRnd.filter(ee.Filter.lt('rnd', 0.7));
var testSet  = withRnd.filter(ee.Filter.gte('rnd', 0.7));

print('Training samples:', trainSet.size());
print('Test samples:', testSet.size());

// ============================================================
// 11. RANDOM FOREST MODEL
// 100 trees, sqrt(21)≈5 variables per split
// ============================================================
var rfModel = ee.Classifier.smileRandomForest({
  numberOfTrees: 100,
  variablesPerSplit: 5,  
  minLeafPopulation: 5,
  seed: 42
}).setOutputMode('REGRESSION')
  .train({
    features: trainSet,
    classProperty: 'label',
    inputProperties: featureBands
  });

print('RF model trained.');

// ============================================================
// 12. MODEL EVALUATION ON TEST SET — RMSE, MAE, R²
// ============================================================
var testPred = testSet.classify(rfModel, 'prediction');

var testEval = testPred.map(function(f) {
  var actual = ee.Number(f.get('label'));
  var pred   = ee.Number(f.get('prediction'));
  var err    = actual.subtract(pred);
  return f.set({
    'error':    err,
    'abs_err':  err.abs(),
    'sq_err':   err.pow(2)
  });
});

// RMSE
var mseVal  = testEval.aggregate_mean('sq_err');
var rmseVal = ee.Number(mseVal).sqrt();

// MAE
var maeVal = testEval.aggregate_mean('abs_err');

// R²
var meanActual = testEval.aggregate_mean('label');
var ssTot = testEval.aggregate_array('label').map(function(v) {
  return ee.Number(v).subtract(meanActual).pow(2);
}).reduce(ee.Reducer.sum());
var ssRes = testEval.aggregate_array('sq_err').reduce(ee.Reducer.sum());
var r2Val = ee.Number(1).subtract(ee.Number(ssRes).divide(ssTot));

print('=== Model Performance (Report These) ===');
print('RMSE (m):', rmseVal);
print('MAE (m):',  maeVal);
print('R²:',       r2Val);
print('Test set n:', testSet.size());

// Feature importance (ranked — print for Methods table)
var importance = rfModel.explain().get('importance');
print('Feature importance (all 21 variables):', importance);

// ============================================================
// 13. PREDICTION MAP — CAMPUS FOREST AREA
// Applied to campus forest area only
// ============================================================
var chmForest = featCam.select(featureBands)
  .classify(rfModel, 'CHM')
  .updateMask(forestCam);

// Full campus (non-forest = 0 for visualization)
var chmFull = chmForest.unmask(0).rename('CHM_predicted');

// Comprehensive CHM statistics
var chmStats = chmFull.updateMask(forestCam).reduceRegion({
  reducer: ee.Reducer.mean()
    .combine(ee.Reducer.stdDev(),              null, true)
    .combine(ee.Reducer.percentile([5,25,50,75,95]), null, true)
    .combine(ee.Reducer.min(),                 null, true)
    .combine(ee.Reducer.max(),                 null, true),
  geometry: campusRegion,
  scale: 10,
  maxPixels: 1e8
});
print('=== CHM Statistics (forested campus pixels) ===');
print(chmStats);

// CHM for extended surrounding woodland
var chmExtForest = featExt.select(featureBands)
  .classify(rfModel, 'CHM')
  .updateMask(forestExt)
  .clip(extendedRegion);

var chmExtStats = chmExtForest.reduceRegion({
  reducer: ee.Reducer.mean()
    .combine(ee.Reducer.stdDev(), null, true)
    .combine(ee.Reducer.percentile([50,95]), null, true),
  geometry: extendedRegion,
  scale: 25,
  maxPixels: 1e10
});
print('=== CHM Statistics (extended 20km woodland) ===');
print(chmExtStats);

// ============================================================
// 14. VEGETATION COVER STATISTICS
// ============================================================
var forestArea = forestCam.multiply(ee.Image.pixelArea())
  .reduceRegion({reducer: ee.Reducer.sum(),
                 geometry: campusRegion, scale: 10, maxPixels: 1e9});
print('Forest cover area (NDVI>0.4, m²):', forestArea);

var totalCampusArea = ee.Image(1).multiply(ee.Image.pixelArea())
  .reduceRegion({reducer: ee.Reducer.sum(),
                 geometry: campusRegion, scale: 10, maxPixels: 1e9});
print('Total campus area (m²):', totalCampusArea);

// Three-class vegetation map
var vegClass = ee.Image(0)
  .where(ndviCam.gt(0).and(ndviCam.lte(0.2)),  1)  // Built/bare
  .where(ndviCam.gt(0.2).and(ndviCam.lte(0.4)), 2) // Shrubs/grass
  .where(ndviCam.gt(0.4),                        3) // Trees/forest
  .clip(campusRegion);

// Area per class
var vegAreas = vegClass.eq(1).addBands(vegClass.eq(2)).addBands(vegClass.eq(3))
  .rename(['built','shrub_grass','tree_forest'])
  .multiply(ee.Image.pixelArea())
  .reduceRegion({reducer: ee.Reducer.sum(),
                 geometry: campusRegion, scale: 10, maxPixels: 1e9});
print('=== Vegetation Class Areas (m²) ===');
print(vegAreas);

// ============================================================
// 15. ROOFTOP PV DETECTION — NDBI-based (GEE supplementary)
// Primary data: ArcGIS Pro digitisation = 90,257.07 m²
// ============================================================
var ndbiCam = s2Cam.normalizedDifference(['B11','B8']);

// Three-condition filter: built-up + non-vegetated + flat
var roofRaw = ndbiCam.gt(0.0)
  .and(ndviCam.lt(0.2))
  .and(slopeCam.lt(10));

// Morphological cleaning (2-pixel kernel open/close)
var kSquare  = ee.Kernel.square(2, 'pixels');
var roofOpen = roofRaw.focal_min({kernel: kSquare, iterations: 1})
                      .focal_max({kernel: kSquare, iterations: 1});

var pvRoofGEE = roofOpen.selfMask().clip(campusRegion);

// GEE roof area estimate
var geeRoofArea = pvRoofGEE.unmask(0).multiply(ee.Image.pixelArea())
  .reduceRegion({reducer: ee.Reducer.sum(),
                 geometry: campusRegion, scale: 10, maxPixels: 1e9});
print('GEE roof area estimate (m²):', geeRoofArea);
print('ArcGIS verified roof area: 90,257.07 m²');
print('GEE overestimate ratio vs ArcGIS: compute from above');


// ============================================================
// 16. PV ENERGY POTENTIAL CALCULATION — THREE SCENARIOS
// Based on ArcGIS-verified area: 90,257.07 m²
// ============================================================
// -- All values are standard published figures for this region --
// Wenzhou annual GHI: ~1,200 kWh/m²/yr (China Meteorological Data)
// Panel efficiency: 20% (monocrystalline, 2023 standard)
// System efficiency: 85% (inverter + wiring losses)
// Usable fraction: 75% (obstructions, spacing, orientation)

// --- Shared parameters ---
var solarGHI    = 1200;   // kWh/m²/yr — Wenzhou annual GHI (PVGIS/CMB data)
var panelEff    = 0.20;   // monocrystalline Si, commercial 2023 standard
var systemEff   = 0.85;   // accounts for inverter, wiring, mismatch losses
var gridFactor  = 0.5810; // kgCO₂/kWh — China Eastern Grid 2021 (NDRC 2022)
var usableFrac  = 0.75;   // 75% of roof usable (excludes HVAC, setbacks)

// --- SCENARIO A: Current buildings (ArcGIS-verified) ---
var roofA        = 90257.07;              // m² — ArcGIS Pro manual digitisation
var usableA      = roofA * usableFrac;    // 67,693 m²
var energyA_MWh  = (usableA * solarGHI * panelEff * systemEff) / 1000;
var co2A         = (energyA_MWh * 1000 * gridFactor) / 1000; // tCO₂

// --- SCENARIO B: Full campus buildout (planning extrapolation) ---
// Method: current roof/current built area × total planned campus area
// Built campus area (university + residential + commercial zones):
//   876,260 (university) + 207,932 (residential) + 157,562 (business) 
//   + 58,019 (religious) + 93,710 (green) + 366,061 (adj.design) = 1,759,544 m²
// Total planned campus area: 2,705,993 m² (from master plan)
var builtAreaCurrent  = 1759544;   // m² — sum of non-woodland land use types
var roofRatioCurrent  = roofA / builtAreaCurrent; // roof density ratio
var plannedTotalArea  = 2705993;   // m² — total campus planned area
var woodlandArea      = 877522;    // m² — woodland reserved (excluded)
var plannedBuiltArea  = plannedTotalArea - woodlandArea; // 1,828,471 m²
var roofB             = roofRatioCurrent * plannedBuiltArea;
var usableB           = roofB * usableFrac;
var energyB_MWh       = (usableB * solarGHI * panelEff * systemEff) / 1000;
var co2B              = (energyB_MWh * 1000 * gridFactor) / 1000;

// --- SCENARIO C: Conservative (50% usable fraction sensitivity) ---
var usableC     = roofA * 0.50;
var energyC_MWh = (usableC * solarGHI * panelEff * systemEff) / 1000;
var co2C        = (energyC_MWh * 1000 * gridFactor) / 1000;

print('=== PV Scenarios ===');
print('SCENARIO A — Current buildings (ArcGIS-verified):');
print('  Roof area: 90,257 m²  |  Usable (75%): 67,693 m²');
print('  Annual energy:', energyA_MWh, 'MWh/yr');
print('  CO₂ avoided:', co2A, 'tCO₂/yr');

print('SCENARIO B — Full campus buildout (planning extrapolation):');
print('  Estimated roof area (m²):', roofB);
print('  Usable area (m²):', usableB);
print('  Annual energy (MWh/yr):', energyB_MWh);
print('  CO₂ avoided (tCO₂/yr):', co2B);

print('SCENARIO C — Conservative 50% usable fraction:');
print('  Usable area: 45,129 m²');
print('  Annual energy (MWh/yr):', energyC_MWh);
print('  CO₂ avoided (tCO₂/yr):', co2C);

print('');
print('=== Integrated Carbon Balance (Scenario A — Current) ===');
print('Campus emissions 2024:      8,352 tCO₂/yr');
print('Vegetation carbon stock:    3,617 tCO₂ (standing stock)');
print('PV offset (Scenario A):    ', co2A, 'tCO₂/yr');
print('Combined A offset total:   ', 3617 + co2A, 'tCO₂');
print('Net position Scenario A:   ', 3617 + co2A - 8352, 'tCO₂ (positive = carbon positive)');

// ============================================================
// 17. PUBLICATION-QUALITY VISUALIZATION
// ============================================================

// --- 17a. True color (Fig base layer) ---
Map.addLayer(s2Cam, {bands:['B4','B3','B2'], min:0, max:0.25, gamma:1.2},
             'Fig_TrueColor');

// --- 17b. NDVI gradient (Fig vegetation health) ---
Map.addLayer(ndviCam, {
  min:-0.1, max:0.85,
  palette:['#d73027','#f46d43','#fdae61','#ffffbf','#a6d96a','#1a9641','#004529']
}, 'Fig_NDVI_PubGrade');

// --- 17c. NDBI for roof detection context ---
Map.addLayer(ndbiCam, {
  min:-0.4, max:0.4,
  palette:['#4575b4','#91bfdb','#ffffbf','#fc8d59','#d73027']
}, 'Fig_NDBI_Diverging');

// --- 17d. CHM classified (5 classes) ---
var chmClass5 = ee.Image(0)
  .where(chmForest.gt(0).and(chmForest.lte(5)),   1)
  .where(chmForest.gt(5).and(chmForest.lte(10)),  2)
  .where(chmForest.gt(10).and(chmForest.lte(15)), 3)
  .where(chmForest.gt(15).and(chmForest.lte(20)), 4)
  .where(chmForest.gt(20).and(chmForest.lte(25)), 5)
  .where(chmForest.gt(25),                         6)
  .selfMask();

Map.addLayer(chmClass5, {
  min:1, max:6,
  palette:['#ffffcc','#c2e699','#78c679','#31a354','#006837','#00441b']
}, 'Fig_CHM_Classified');

// --- 17e. Carbon density proxy (CHM-derived) ---
var carbonProxy = ee.Image(0)
  .where(chmForest.gt(0).and(chmForest.lte(5)),    5)
  .where(chmForest.gt(5).and(chmForest.lte(10)),  15)
  .where(chmForest.gt(10).and(chmForest.lte(15)), 40)
  .where(chmForest.gt(15).and(chmForest.lte(20)), 80)
  .where(chmForest.gt(20).and(chmForest.lte(25)),120)
  .where(chmForest.gt(25),                        180)
  .rename('CarbonProxy_tCO2ha')
  .selfMask();

Map.addLayer(carbonProxy, {
  min:5, max:180,
  palette:['#ffffb2','#fecc5c','#fd8d3c','#f03b20','#bd0026']
}, 'Fig_Carbon_Density');

// --- 17f. PV roof candidates ---
Map.addLayer(pvRoofGEE, {palette:['#ff7f00']}, 'Fig_PV_Roof_GEE');

// --- 17g. Vegetation 3-class ---
Map.addLayer(vegClass, {
  min:0, max:3,
  palette:['white','#d0d0d0','#a8ddb5','#2ca25f']
}, 'Fig_VegClass_3cat');

// ============================================================
// 18. ALL EXPORT TASKS — UTM Zone 50N (EPSG:32650)
// ============================================================
var CRS = 'EPSG:32650';  // Correct UTM for Wenzhou, China

// Helper merge function
function mergeObj(a, b) {
  var r = {};
  for (var k in a) { if (a.hasOwnProperty(k)) r[k] = a[k]; }
  for (var k in b) { if (b.hasOwnProperty(k)) r[k] = b[k]; }
  return r;
}

// Base parameters for campus-scale exports
var baseCam = {
  region: campusRegion, scale: 10,
  crs: CRS, maxPixels: 1e9,
  folder: 'WKU_Carbon_PubFigs'
};

// Base parameters for extended-region exports
var baseExt = {
  region: extendedRegion, scale: 25,
  crs: CRS, maxPixels: 1e13,
  folder: 'WKU_Carbon_PubFigs'
};

// ---- Raster Exports ----
Export.image.toDrive(mergeObj(
  {image: s2Cam.select(['B4','B3','B2']).multiply(10000).int16(),
   description: 'E01_TrueColor_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: ndviCam.multiply(10000).int16(),
   description: 'E02_NDVI_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: ndbiCam.multiply(10000).int16(),
   description: 'E03_NDBI_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: chmFull.float(),
   description: 'E04_CHM_Continuous_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: chmClass5.byte(),
   description: 'E05_CHM_Classified5_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: pvRoofGEE.unmask(0).byte(),
   description: 'E06_PV_Roof_GEE_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: vegClass.byte(),
   description: 'E07_VegClass3_Campus'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: carbonProxy.unmask(0).float(),
   description: 'E08_CarbonDensity_Proxy'}, baseCam));

Export.image.toDrive(mergeObj(
  {image: chmExtForest.float(),
   description: 'E09_CHM_Extended_20km'}, baseExt));

Export.image.toDrive(mergeObj(
  {image: gediMasked.float(),
   description: 'E10_GEDI_RH98_Extended'}, baseExt));

// ---- Vector/Table Exports ----
// RF scatter data (for R ggplot)
Export.table.toDrive({
  collection: testPred.select(['label','prediction']),
  description: 'T01_RF_Test_Scatter',
  folder: 'WKU_Carbon_PubFigs', fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: trainSet.classify(rfModel,'prediction').select(['label','prediction']),
  description: 'T02_RF_Train_Scatter',
  folder: 'WKU_Carbon_PubFigs', fileFormat: 'CSV'
});

// GEDI training point locations
Export.table.toDrive({
  collection: allSamples.select(['label']),
  description: 'T03_GEDI_TrainPoints',
  folder: 'WKU_Carbon_PubFigs', fileFormat: 'SHP'
});

// Campus boundary polygon
Export.table.toDrive({
  collection: ee.FeatureCollection([ee.Feature(campusRegion)]),
  description: 'T04_Campus_Boundary',
  folder: 'WKU_Carbon_PubFigs', fileFormat: 'SHP'
});

// Extended region boundary
Export.table.toDrive({
  collection: ee.FeatureCollection([ee.Feature(extendedRegion)]),
  description: 'T05_Extended_Boundary',
  folder: 'WKU_Carbon_PubFigs', fileFormat: 'SHP'
});

print('=== ALL EXPORT TASKS SUBMITTED ===');
print('Check Tasks tab → Run all → Files saved to: WKU_Carbon_PubFigs/');
print('CRS: EPSG:32650 (WGS84 UTM Zone 50N)');
