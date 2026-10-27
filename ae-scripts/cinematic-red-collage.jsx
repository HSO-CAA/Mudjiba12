/*
 * Cinematic Red Collage — After Effects ExtendScript
 *
 * Applies a cinematic color grade to the selected footage layer and builds
 * the "red collage poster" style around it:
 *   - deep crimson background with hand-drawn (wobbly) grid lines
 *   - rounded card with a cream paper border + drop shadow
 *   - red/cream split-tone grade, film grain, vignette, print-dot texture
 *
 * Usage:
 *   1. Open your comp and select the footage layer (or leave nothing selected
 *      and the first footage layer is used).
 *   2. File > Scripts > Run Script File... and pick this file.
 *
 * Everything is added as named effects/layers ("CG ..." / "STYLE ..."), so
 * each part can be toggled or tweaked by hand afterwards. Ctrl/Cmd+Z undoes
 * the whole thing in one step.
 */

(function cinematicRedCollage() {

    // ------------------------------------------------------------------
    // Settings — tweak these freely
    // ------------------------------------------------------------------
    var CONFIG = {
        // Palette taken from the reference
        bgRed:      "#7A1519",   // background crimson
        gridRed:    "#D0473F",   // grid lines
        paperCream: "#EFE3CB",   // paper border
        washRed:    "#9E1C22",   // red cast over the frame

        // Split tone (Tritone)
        toneHighlights: "#F4E4C4",
        toneMidtones:   "#9A3A30",
        toneShadows:    "#170708",
        toneBlend:      45,      // % of original kept (higher = subtler)

        contrast:     22,
        brightness:   -6,
        saturation:   -30,
        vibrance:     10,

        blackAndWhite: false,    // true = B&W subject like the reference portrait

        useCard:      true,      // false = full-frame grade only, no card/background
        gridColumns:  6,
        grainAmount:  7,
        vignette:     55,        // vignette layer opacity %
        printDots:    10         // print-dot texture opacity %, 0 to skip
    };

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    var warnings = [];

    function hex(h) {
        h = h.replace("#", "");
        return [
            parseInt(h.substr(0, 2), 16) / 255,
            parseInt(h.substr(2, 2), 16) / 255,
            parseInt(h.substr(4, 2), 16) / 255
        ];
    }

    function colorVal(h) {
        var c = hex(h);
        return [c[0], c[1], c[2], 1];
    }

    function addFx(layer, matchName, label) {
        var parade = layer.property("ADBE Effect Parade");
        if (!parade.canAddProperty(matchName)) {
            warnings.push("Effect not available: " + matchName);
            return null;
        }
        var fx = parade.addProperty(matchName);
        if (label) {
            try { fx.name = label; } catch (e) {}
        }
        return fx;
    }

    // Sets the first property found under any of `names`; tries each value
    // in `values` until one is accepted (some effects use 0-255 vs 0-100).
    function setP(fx, names, values) {
        if (!fx) return false;
        var candidates = (values && values.__try) ? values.list : [values];
        for (var i = 0; i < names.length; i++) {
            var p = null;
            try { p = fx.property(names[i]); } catch (e) { p = null; }
            if (!p) continue;
            for (var j = 0; j < candidates.length; j++) {
                try { p.setValue(candidates[j]); return true; } catch (e2) {}
            }
        }
        warnings.push("Could not set '" + names[0] + "' on " + fx.name);
        return false;
    }

    function tryValues() {
        return { __try: true, list: Array.prototype.slice.call(arguments) };
    }

    function addSolid(comp, colorHex, name) {
        return comp.layers.addSolid(hex(colorHex), name, comp.width, comp.height,
                                    comp.pixelAspect, comp.duration);
    }

    function roundRectShape(x, y, w, h, r) {
        var k = 0.5523 * r;
        var s = new Shape();
        s.vertices = [
            [x + r, y], [x + w - r, y],
            [x + w, y + r], [x + w, y + h - r],
            [x + w - r, y + h], [x + r, y + h],
            [x, y + h - r], [x, y + r]
        ];
        s.inTangents = [
            [-k, 0], [0, 0],
            [0, -k], [0, 0],
            [k, 0], [0, 0],
            [0, k], [0, 0]
        ];
        s.outTangents = [
            [0, 0], [k, 0],
            [0, 0], [0, k],
            [0, 0], [-k, 0],
            [0, 0], [0, -k]
        ];
        s.closed = true;
        return s;
    }

    function ellipseShape(cx, cy, rx, ry) {
        var kx = 0.5523 * rx, ky = 0.5523 * ry;
        var s = new Shape();
        s.vertices    = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
        s.inTangents  = [[-kx, 0], [0, -ky], [kx, 0], [0, ky]];
        s.outTangents = [[kx, 0], [0, ky], [-kx, 0], [0, -ky]];
        s.closed = true;
        return s;
    }

    function addMask(layer, shape, feather, inverted) {
        var mask = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        mask.property("ADBE Mask Shape").setValue(shape);
        if (feather) mask.property("ADBE Mask Feather").setValue([feather, feather]);
        if (inverted) mask.inverted = true;
        return mask;
    }

    function setTrackMatte(layer, matte) {
        if (typeof layer.setTrackMatte === "function") {
            layer.setTrackMatte(matte, TrackMatteType.ALPHA);   // AE 2023+
        } else {
            matte.moveBefore(layer);                             // older AE: matte must sit directly above
            layer.trackMatteType = TrackMatteType.ALPHA;
        }
        matte.enabled = false;
    }

    function findFootageLayer(comp) {
        var sel = comp.selectedLayers;
        if (sel.length > 0 && sel[0] instanceof AVLayer && sel[0].hasVideo) return sel[0];
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            if (l instanceof AVLayer && l.hasVideo && l.source instanceof FootageItem &&
                !(l.source.mainSource instanceof SolidSource)) {
                return l;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Main
    // ------------------------------------------------------------------
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
        alert("Open a composition first (click inside the timeline), then run the script again.");
        return;
    }

    var footage = findFootageLayer(comp);
    if (!footage) {
        alert("No footage layer found. Select the footage layer and run the script again.");
        return;
    }

    for (var n = 1; n <= comp.numLayers; n++) {
        if (comp.layer(n).name === "STYLE - BG Red") {
            if (!confirm("This comp already has the style applied. Apply it again?")) return;
            break;
        }
    }

    app.beginUndoGroup("Cinematic Red Collage");
    try {
        var W = comp.width, H = comp.height, M = Math.min(W, H);

        // ---------------- 1. Cinematic grade on the footage ----------------
        var fx;

        fx = addFx(footage, "ADBE Brightness & Contrast 2", "CG 01 - Contrast");
        setP(fx, ["Brightness"], CONFIG.brightness);
        setP(fx, ["Contrast"], CONFIG.contrast);

        fx = addFx(footage, "ADBE Vibrance", "CG 02 - Saturation");
        setP(fx, ["Vibrance"], CONFIG.vibrance);
        setP(fx, ["Saturation"], CONFIG.saturation);

        if (CONFIG.blackAndWhite) {
            fx = addFx(footage, "ADBE Tint", "CG 03 - Black & White");
            setP(fx, ["Amount to Tint"], 100);
        }

        fx = addFx(footage, "ADBE Tritone", "CG 04 - Red/Cream Split Tone");
        setP(fx, ["Highlights"], colorVal(CONFIG.toneHighlights));
        setP(fx, ["Midtones"], colorVal(CONFIG.toneMidtones));
        setP(fx, ["Shadows"], colorVal(CONFIG.toneShadows));
        setP(fx, ["Blend With Original"], CONFIG.toneBlend);

        fx = addFx(footage, "ADBE Unsharp Mask2", "CG 05 - Crisp");
        setP(fx, ["Amount"], 35);
        setP(fx, ["Radius"], 1.2);

        // ---------------- 2. Card + paper + background ----------------
        var styleTop = footage;   // highest layer of the card stack so far

        if (CONFIG.useCard) {
            var margin = Math.round(M * 0.07);
            var cardX = margin, cardY = Math.round(margin * 1.4);
            var cardW = W - 2 * cardX, cardH = H - 2 * cardY;
            var radius = Math.round(M * 0.05);
            var border = Math.round(M * 0.012);

            // Background crimson
            var bgRed = addSolid(comp, CONFIG.bgRed, "STYLE - BG Red");
            bgRed.moveAfter(footage);

            // Hand-drawn grid lines
            var bgGrid = addSolid(comp, CONFIG.gridRed, "STYLE - BG Grid");
            bgGrid.moveAfter(footage);
            fx = addFx(bgGrid, "ADBE Grid", "Grid");
            setP(fx, ["Size From"], 2);
            setP(fx, ["Width"], Math.round(W / CONFIG.gridColumns));
            setP(fx, ["Border"], Math.max(2, Math.round(M * 0.004)));
            setP(fx, ["Color"], colorVal(CONFIG.gridRed));
            fx = addFx(bgGrid, "ADBE Turbulent Displace", "Wobble");
            setP(fx, ["Amount"], 22);
            setP(fx, ["Size"], 260);
            bgGrid.opacity.setValue(60);

            // Cream paper border behind the card
            var paper = addSolid(comp, CONFIG.paperCream, "STYLE - Paper Border");
            paper.moveAfter(footage);
            addMask(paper, roundRectShape(cardX - border, cardY - border,
                                          cardW + 2 * border, cardH + 2 * border,
                                          radius + border));
            fx = addFx(paper, "ADBE Drop Shadow", "Shadow");
            setP(fx, ["Shadow Color"], [0, 0, 0, 1]);
            setP(fx, ["Opacity"], tryValues(140, 55));   // 0-255 on most versions, % on some
            setP(fx, ["Direction"], 160);
            setP(fx, ["Distance"], Math.round(M * 0.012));
            setP(fx, ["Softness"], Math.round(M * 0.04));

            // Rounded card matte for the footage
            var matte = addSolid(comp, "#FFFFFF", "STYLE - Card Matte");
            matte.moveBefore(footage);
            addMask(matte, roundRectShape(cardX, cardY, cardW, cardH, radius));
            setTrackMatte(footage, matte);

            // Scale footage so it still covers the card
            var fit = Math.max(cardW / W, cardH / H) * 1.02;
            var sc = footage.scale.value;
            footage.scale.setValue([sc[0] * fit, sc[1] * fit, sc.length > 2 ? sc[2] : 100]);

            styleTop = matte;
        }

        // ---------------- 3. Finishing layers over everything ----------------
        var wash = addSolid(comp, CONFIG.washRed, "STYLE - Red Wash");
        wash.moveBefore(styleTop);
        wash.blendingMode = BlendingMode.SOFT_LIGHT;
        wash.opacity.setValue(30);

        var lastTop = wash;

        if (CONFIG.printDots > 0) {
            var dots = addSolid(comp, "#000000", "STYLE - Print Dots");
            dots.moveBefore(lastTop);
            fx = addFx(dots, "ADBE Cell Pattern", "Halftone Dots");
            setP(fx, ["Disperse"], 0);
            setP(fx, ["Size"], Math.max(4, Math.round(M / 220)));
            dots.blendingMode = BlendingMode.OVERLAY;
            dots.opacity.setValue(CONFIG.printDots);
            lastTop = dots;
        }

        var vig = addSolid(comp, "#000000", "STYLE - Vignette");
        vig.moveBefore(lastTop);
        addMask(vig, ellipseShape(W / 2, H / 2, W * 0.62, H * 0.58), Math.round(M * 0.35), true);
        vig.blendingMode = BlendingMode.MULTIPLY;
        vig.opacity.setValue(CONFIG.vignette);

        var grain = addSolid(comp, "#808080", "STYLE - Film Grain");
        grain.adjustmentLayer = true;
        grain.moveBefore(vig);
        fx = addFx(grain, "ADBE Noise", "Grain");
        setP(fx, ["Amount of Noise"], CONFIG.grainAmount);
        setP(fx, ["Noise Type", "Use Color Noise"], 0);

    } catch (err) {
        warnings.push("Stopped early: " + err.toString() + (err.line ? " (line " + err.line + ")" : ""));
    } finally {
        app.endUndoGroup();
    }

    if (warnings.length) {
        alert("Done, with notes:\n\n- " + warnings.join("\n- "));
    } else {
        alert("Cinematic Red Collage applied.\nToggle the 'CG' effects and 'STYLE' layers to adjust.");
    }
})();
