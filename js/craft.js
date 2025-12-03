let recipeTypes = ["HELMET","CHESTPLATE","LEGGINGS","BOOTS","RELIK","WAND","SPEAR","DAGGER","BOW","RING","NECKLACE","BRACELET","POTION", "SCROLL","FOOD"];
let levelTypes = ["1-3","3-5","5-7","7-9","10-13","13-15","15-17","17-19","20-23","23-25","25-27","27-29","30-33","33-35","35-37","37-39","40-43","43-45","45-47","47-49","50-53","53-55","55-57","57-59","60-63","63-65","65-67","67-69","70-73","73-75","75-77","77-79","80-83","83-85","85-87","87-89","90-93","93-95","95-97","97-99","100-103","103-105",]

/**
 * A constant encompassing all the necessary info for crafted item encoding.
 * if something in this structure changes, the version number must be increased
 * and handled in the respective decoder.
 * The values are detailed in ENCODING.md.
 */
const CRAFTER_ENC = {
    CRAFTED_ATK_SPD: {
        "SLOW": 0, 
        "NORMAL": 1, 
        "FAST": 2,
        "BITLEN": 4,
    },
    MAT_TIERS: 3,
    MAT_TIER_BITLEN: 3,
    NUM_MATS: 2,
    NUM_INGS: 6,
    ING_ID_BITLEN: 12,
    RECIPE_ID_BITLEN: 12,
    CRAFTED_VERSION_BITLEN: 7,
    CRAFTED_ENCODING_VERSION: 2,
}

// An array which is the inverse of CRAFTER_ENC.CRAFTED_STK_SPD to map ID => name
CRAFTER_ENC.CRAFTED_ATK_SPD_ID = Object.keys(CRAFTER_ENC.CRAFTED_ATK_SPD).slice(0, -1);

/**
 * @param {Craft} craft 
 * Encodes a given craft and returns the resulting bit vector.
 */
function encodeCraft(craft) {
    let craftVec = new EncodingBitVector(0, 0, CRAFTER_ENC);  
    if (!craft) return craftVec;
    // Legacy versions always start with their first bit set
    craftVec.append(0, 1);

    // Encode version
    craftVec.append(CRAFTER_ENC.CRAFTED_ENCODING_VERSION, CRAFTER_ENC.CRAFTED_VERSION_BITLEN);

    // Encode ingredients
    for (const ing of craft.ingreds) {
        craftVec.append(ing.get("id"), CRAFTER_ENC.ING_ID_BITLEN);
    }

    // Encode recipe
    craftVec.append(craft.recipe.get("id"), CRAFTER_ENC.RECIPE_ID_BITLEN);

    // Encode material tiers
    for (const mat_tier of craft.mat_tiers) {
        craftVec.append(mat_tier - 1, CRAFTER_ENC.MAT_TIER_BITLEN);
    }

    // Encode attack speed
    if (craft.statMap.get("category") === "weapon") {
        craftVec.append(CRAFTER_ENC.CRAFTED_ATK_SPD[craft.atkSpd], CRAFTER_ENC.CRAFTED_ATK_SPD.BITLEN)
    }

    // Pad to fit into a B64 string perfectly
    craftVec.append(0, 6 - (craftVec.length % 6));
    return craftVec;
}

/**
 * Decodes a given craft and returns the resulting crafted item.
 * Falls back to legacy parsing if the hash is in legacy format, see `getCraftFromHash`.
 * 
 * @param {Object} arg 
 * @param {BitVectorCursor} arg.cursor - A bit vector cursor pointing to the beginning of the crafted hash.
 * @param {string} arg.hash - A Base64 string representation of the crafted item.
 */
function decodeCraft({cursor, hash}) {
    if (cursor === undefined) {
        assert(hash !== undefined, "decodeCraft must be called with either a URL or a BitVectorCursor.");
        cursor = new BitVectorCursor(new BitVector(hash, hash.length * 6));
    }

    // Since the cursor doesn't necessarily point to the beginning of the hash
    // (in the case where it's part of a build's URL encoding) save it so we can
    // slice off just the hash of the item.
    const hashStartIdx = cursor.currIdx;

    // 1 if legacy encoding, 0 otherwise
    const legacy = cursor.advance();
    if (legacy) {
        return getCraftFromHash("CR-" + hash);
    }

    // Here for future usage
    const version = cursor.advanceBy(CRAFTER_ENC.CRAFTED_VERSION_BITLEN);

    // Decode ingredients
    const ings = [];
    for (let i = 0; i < CRAFTER_ENC.NUM_INGS; ++i) {
        const ing = ingMap.get(ingIDMap.get(cursor.advanceBy(CRAFTER_ENC.ING_ID_BITLEN)));
        ings.push(expandIngredient(ing)); 
    }

    // Decode recipe
    const recipe = expandRecipe(recipeMap.get(recipeIDMap.get(cursor.advanceBy(CRAFTER_ENC.RECIPE_ID_BITLEN))));

    // Decode material tiers
    const matTiers = [];
    for (let i = 0; i < CRAFTER_ENC.NUM_MATS; ++i) {
        matTiers.push(cursor.advanceBy(CRAFTER_ENC.MAT_TIER_BITLEN) + 1);
    }

    // Decode attack speed, set default to slow
    let atkSpd = "SLOW";
    if (weaponTypes.includes(recipe.get("type").toLowerCase())) {
        atkSpd = CRAFTER_ENC.CRAFTED_ATK_SPD_ID[cursor.advanceBy(CRAFTER_ENC.CRAFTED_ATK_SPD.BITLEN)];
    }

    // Skip padding
    cursor.skip(6 - ((cursor.currIdx - hashStartIdx) % 6));

    return new Craft(recipe, matTiers, ings, atkSpd, cursor.bitVec.sliceB64(hashStartIdx, cursor.currIdx));
}

/**
 * Legacy version of `encodeCraft`.
 * here for documentation only.
 */
function encodeCraftLegacy(craft) {
    if (craft) {
        let atkSpds = ["SLOW","NORMAL","FAST"];
        let craft_string =  "1" + 
                            Base64.fromIntN(craft.ingreds[0].get("id"), 2) + 
                            Base64.fromIntN(craft.ingreds[1].get("id"), 2) +
                            Base64.fromIntN(craft.ingreds[2].get("id"), 2) +
                            Base64.fromIntN(craft.ingreds[3].get("id"), 2) +
                            Base64.fromIntN(craft.ingreds[4].get("id"), 2) +
                            Base64.fromIntN(craft.ingreds[5].get("id"), 2) + 
                            Base64.fromIntN(craft.recipe.get("id"),2) + 
                            Base64.fromIntN(craft.mat_tiers[0] + (craft.mat_tiers[1]-1)*3, 1) +  //this maps tiers [a,b] to a+3b.
                            Base64.fromIntN(atkSpds.indexOf(craft["atkSpd"]),1);
        return craft_string;
    }
    return "";
}

/**
 * Legacy verison of `decodeCraft`.
 */
function getCraftFromHash(hash) {
    let name = hash.slice();
    try {
        if (name.slice(0,3) === "CR-") {
            name = name.substring(3);
        } else {
            throw new Error("Not a crafted item!");
        }
        version = name.substring(0,1);
        name = name.substring(1);
        if (version === "1") {
            let ingreds = [];
            for (let i = 0; i < 6; i ++ ) {
                ingreds.push( expandIngredient(ingMap.get(ingIDMap.get(Base64.toInt(name.substring(2*i,2*i+2))))) );
            }
            let recipe = expandRecipe(recipeMap.get(recipeIDMap.get(Base64.toInt(name.substring(12,14)))));
            
            tierNum = Base64.toInt(name.substring(14,15));
            let mat_tiers = [];
            mat_tiers.push(tierNum % 3 == 0 ? 3 : tierNum % 3);
            mat_tiers.push(Math.floor((tierNum-0.5) / 3)+1); //Trying to prevent round-off error, don't yell at me
            let atkSpd = Base64.toInt(name.substring(15));
            let atkSpds = ["SLOW","NORMAL","FAST"];
            let attackSpeed = atkSpds[atkSpd];
            return new Craft(recipe,mat_tiers,ingreds,attackSpeed,"1"+name);
        }
    } catch (error) {
        console.log(error);
        return undefined;
    }
    
    
}


/** 
 * Creates a crafted item object.
 */
class Craft {

    /** Constructs a craft.
     * 
     * @param recipe - Helmet-1-3 (id), etc. A recipe object.
     * @param mat_tiers - [1->3, 1->3]. An array with 2 numbers.
     * @param ingreds - []. An array with 6 entries, each with an ingredient Map.
    */
    constructor(recipe, mat_tiers, ingreds, attackSpeed, hash) {
        this.recipe = recipe;
        this.mat_tiers = mat_tiers;
        this.ingreds = ingreds;
        this.statMap = new Map(); //can use the statMap as an expanded Item
        this.atkSpd = attackSpeed;
        this.hash = "CR-" + hash;
        this.statMap = this.initCraftStats();
        this.statMap.set("hash", this.hash);
    }
    
    /**
     * @deprecated function is not used and doesn't work with weapon powderings
     */
    applyPowders() {
        if (this.statMap.get("category") === "armor" || this.statMap.get("category" === "accessory")) { // what is the second check for?
            //double apply armor powders
            for(const id of this.statMap.get("powders")){
                let powder = powderStats[id];
                let name = powderNames.get(id);
                this.statMap.set(name.charAt(0) + "Def", (this.statMap.get(name.charAt(0)+"Def") || 0) + 2 * powder["defPlus"]);
                this.statMap.set(skp_elements[(skp_elements.indexOf(name.charAt(0)) + 4 )% 5] + "Def", (this.statMap.get(skp_elements[(skp_elements.indexOf(name.charAt(0)) + 4 )% 5]+"Def") || 0) - 2 * powder["defMinus"]);
            }
        }else if (this.statMap.get("category") === "weapon") {
            //do nothing - weapon powders are handled in displayExpandedItem
        }
    }

    /**
     * Sets the hash of the item.
     * This method is straight up unsafe.
     * This allows the hash of the Craft to be different than the actual Craft.
     * 
     * @param {string} hash - the hash to set for this item
     */
    setHash(hash) {
        this.hash = "CR-" + hash;
        this.statMap.set("name", this.hash);
        this.statMap.set("displayName", this.hash);
        this.statMap.set("hash", this.hash);
    }

    /** Get all stats for this build.
     * 
     * @pre The craft itself should be valid. No checking of validity of pieces is done here.
     * @returns {Map} a stat map base off the information provided to the constructor
    */
    initCraftStats() {

        // set basic things on the stat map
        let statMap = this.initStatMap();
        let craftType = statMap.get("type");
        console.log("Accessing craft type... found value: " + craftType);
        statMap.set("category", getCategory(craftType));
        statMap.set("slots", this.getPowderSlotCount(statMap));

        // set consumable charges
        statMap.set("charges", this.getConsumableCharges(statMap));

        /* Change certain IDs based on material tier. 
            healthOrDamage changes.
            duration and durability change. (but not basicDuration)
        */
        let matmult = this.getMaterialMultiplier();
        let lowHealthOrDamage = Math.floor(this.recipe.get("healthOrDamage")[0] * matmult);
        let highHealthOrDamage = Math.floor(this.recipe.get("healthOrDamage")[1] * matmult);
        if (statMap.get("category") === "consumable") {
            if (this.isAllNone()) {
                statMap.set("charges", 3);
                statMap.set("duration", this.recipe.get("basicDuration"));
                statMap.set("hp", lowHealthOrDamage + "-" + highHealthOrDamage);
            }
            // probably could factor in a new method becuase this code is repeated
            statMap.set("duration", [Math.round( statMap.get("duration")[0] * matmult ), Math.round( statMap.get("duration")[1] * matmult )]);
        } else {
            //durability modifier
            statMap.set("durability", [Math.round( statMap.get("durability")[0] * matmult ), Math.round( statMap.get("durability")[1] * matmult )]);
        }

        if (statMap.get("category") === "weapon") {
            statMap.set("atkSpd", this.atkSpd);
            this.applyWeaponDamages(lowHealthOrDamage, highHealthOrDamage, statMap);
        } else if (statMap.get("category") === "armor") {
            statMap.set("hp",lowHealthOrDamage+"-"+highHealthOrDamage);
            statMap.set("hpLow",lowHealthOrDamage);
        }

        // apply powder ingredients to armor and accessories
        if (statMap.get("category") === "armor" || statMap.get("category") == "accessory") {
            this.applyPowderIngredients(statMap);
        }

        // apply the ingredients
        this.applyAllIngredients(statMap, craftType);

        // handle requirements/attributes/IDs/etc.
        statMap = this.clampAttributes(statMap);
        this.setSkillpointsAndRequirements(statMap);
        this.fillEmptyRolledIDs(statMap);

        return statMap;
    }

    /**
     * Applies powder ingredients to the Craft.
     * 
     * @param {Map} statMap - the stat map to apply the powder ingredients to
     */
    applyPowderIngredients(statMap) {
        for (let n in this.ingreds) {
            let ingred = this.ingreds[n];
            if (!ingred.get("isPowder")) {
                continue;
            }
            this.applyPowderIngredient(ingred, statMap);
        }
    }

    /**
     * Applies all ingredients to the stat map.
     * 
     * @param {Map} statMap - the stat map to apply the ingredients to
     * @param {string} craftType - the type of item being crafted
     */
    applyAllIngredients(statMap, craftType) {
        let eff = this.getIngredientEffectiveness();
        let eff_flat = eff.flat();
        statMap.set("ingredEffectiveness", eff_flat);
        //console.log(eff_flat);
        //apply ingredient ids
        for (const n in this.ingreds) {
            //apply ingredient effectivness - on ids, and reqs (itemIDs). NOT on durability, duration, or charges.
            this.applyIngredient(this.ingreds[n], (eff_flat[n] / 100).toFixed(2), craftType, statMap);
        }
    }

    /**
     * Applies the weapon damages to the stat map.
     * Adds the powders to the stat map, but does NOT compute each powder's effect on damage.
     * 
     * @pre check that this craft is a weapon as this method performs no checks.
     * @param {number} damageLow - the low side of the damage range
     * @param {number} damageHigh - the high side of the damage range
     * @param {Map} statMap - the stat map to apply the damages to
     */
    applyWeaponDamages(damageLow, damageHigh, statMap) {

        //attack damages oh boy
        let ratio = this.getAttackSpeedRatio();
        let nDamBaseLow = damageLow;
        let nDamBaseHigh = damageHigh;
        nDamBaseLow = Math.floor(nDamBaseLow * ratio);
        nDamBaseHigh = Math.floor(nDamBaseHigh * ratio);
        let elemDamBaseLow = [0, 0, 0, 0, 0];
        let elemDamBaseHigh = [0, 0, 0, 0, 0];
        /*
         * APPLY POWDERS - MAY NOT BE CORRECT
        */
        let powders = [];
        for (let n in this.ingreds) {
            let ingred = this.ingreds[n];
            if (ingred.get("isPowder")) {
                powders.push(ingred.get("pid"));
            }
        }

        // for (const p of powders) {
        //     /* Powders as ingredients in crafted weapons are different than powders applied to non-crafted weapons. Thanks to nbcss for showing me the math.
        //     */
        //     let powder = powderStats[p];  //use min, max, and convert
        //     let element = Math.floor((p+0.01)/6); //[0,4], the +0.01 attempts to prevent division error
        //     let diffLow = Math.floor(nDamBaseLow * powder.convert/100);
        //     nDamBaseLow -= diffLow;
        //     elemDamBaseLow[element] += diffLow + Math.floor( (powder.min + powder.max) / 2 );
        //     let diffHigh = Math.floor(nDamBaseHigh * powder.convert/100);
        //     nDamBaseHigh -= diffHigh;
        //     elemDamBaseHigh[element] += diffHigh + Math.floor( (powder.min + powder.max) / 2 );
        // }
        statMap.set("ingredPowders", powders);

        this.computeElementDamage("n", nDamBaseLow, nDamBaseHigh, statMap);
        for (const e in skp_elements) {
            this.computeElementDamage(skp_elements[e], elemDamBaseLow[e], elemDamBaseHigh[e], statMap);
        }
    }

    /**
     * Adds the elemental damage of the passed element to the stat map.
     * 
     * @param {string} elementPrefix - the element prefix for type
     * @param {number} damageBaseLow - the low of a base damage range
     * @param {number} damageBaseHigh - the high of the base damage range
     * @param {map} statMap - the stat map to add the damage to
     */
    computeElementDamage(elementPrefix, damageBaseLow, damageBaseHigh, statMap) {

        /* I create a separate variable for each low damage range because we need one damage range to calculate damage with, and it's custom to use the maximum range of the range range.
        */

        // store mults for low1, low2, high1, high2
        const upperMult = 1.1;
        const lowerMult = 0.9;

        // compute and store highs and lows
        statMap.set(elementPrefix+"DamBaseLow", damageBaseLow);
        statMap.set(elementPrefix+"DamBaseHigh", damageBaseHigh);
        let low1 = Math.floor(damageBaseLow * lowerMult);
        let low2 = Math.floor(damageBaseLow * upperMult);
        let high1 = Math.floor(damageBaseHigh * lowerMult);
        let high2 = Math.floor(damageBaseHigh * upperMult);
        statMap.set(elementPrefix+"DamLow", low1+"-"+low2);
        statMap.set(elementPrefix+"Dam", high1+"-"+high2);

    }

    /**
     * Applies the passed ingriedent to the passed stat map.
     * 
     * @param {*} ingred - the ingredient to apply
     * @param {number} eff_mult - the effectiveness of the ingredient
     * @param {string} craftType - the type of item being crafted
     * @param {Map} statMap - the stat map to apply stats to
     */
    applyIngredient(ingred, eff_mult, craftType, statMap) {
        this.applyIngredientItemIDs(ingred, craftType, eff_mult, statMap);
        this.applyIngredientConsumableIDs(ingred, statMap);
        this.applyMaxMinRolls(ingred, eff_mult, statMap);
    }

    /**
     * Applies the maximum and minumum rolls to the stat map.
     * 
     * @param {*} ingred - the ingredient to apply
     * @param {number} eff_mult - the effectiveness multiplier
     * @param {Map} statMap - the stat map to add the ingridient info to
     */
    applyMaxMinRolls(ingred, eff_mult, statMap) {
        for (const [key, value] of ingred.get("ids").get("maxRolls")) {
            if (!value || value == 0) {
                continue;
            }
            let rolls = [ingred.get("ids").get("minRolls").get(key), value];
            rolls = rolls.map(x => Math.floor(x * eff_mult)).sort(function (a, b) { return a - b; });
            statMap.get("minRolls").set(key, (statMap.get("minRolls").get(key)) ? statMap.get("minRolls").get(key) + rolls[0] : rolls[0]);
            statMap.get("maxRolls").set(key, (statMap.get("maxRolls").get(key)) ? statMap.get("maxRolls").get(key) + rolls[1] : rolls[1]);
        }
    }

    /**
     * Applies consumable IDs to the craft.
     * 
     * @param {*} ingred - the ingredient to add
     * @param {Map} statMap - the stat map to add the ingredient info to
     */
    applyIngredientConsumableIDs(ingred, statMap) {
        for (const [key, value] of ingred.get("consumableIDs")) {
            // neither duration nor charges are affected by effectiveness
            if (key === "dura") {
                statMap.set("duration", statMap.get("duration").map(x => x + value));
            } else {
                console.log("Before:"+statMap.get("charges"));
                statMap.set(key, statMap.get("charges") + value);
                console.log("After:"+statMap.get("charges"));
            }
        }
    }

    /**
     * Applies the item IDs of the ingredient.
     * 
     * @param {*} ingred - the ingredient to add the itemIDs to
     * @param {string} craftType - the craft type
     * @param {number} eff_mult - the effectiveness multiplier
     * @param {Map} statMap - the stat map to add information to
     */
    applyIngredientItemIDs(ingred, craftType, eff_mult, statMap) {
        for (const [key, value] of ingred.get("itemIDs")) {
            if (key !== "dura" && !isConsumable(craftType)) { //consumables NEVER get reqs
                const effMult = !ingred.get("isPowder") ? eff_mult : 1;
                statMap.set(key, Math.round(statMap.get(key) + value * effMult));
                continue;
            }
            //durability, NOT affected by effectiveness
            statMap.set("durability", statMap.get("durability").map(x => x + value));
        }
    }

    /**
     * Adds the skillpoints and skillpoint requirements to the stat map.
     * 
     * @param {Map} statMap - the stat map to add the skillpoints/requirements to
     */
    setSkillpointsAndRequirements(statMap) {
        for (const e in skp_order) {
            const skillpointCount = statMap.get("maxRolls").has(skp_order[e]) ? statMap.get("maxRolls").get(skp_order[e]) : 0;
            statMap.set(skp_order[e], skillpointCount);
            statMap.get("skillpoints")[e] = skillpointCount;
            statMap.get("reqs")[e] = statMap.has(skp_order[e] + "Req") && !consumableTypes.includes(statMap.get("type")) ? statMap.get(skp_order[e] + "Req") : 0;
        }
    }

    /**
     * Loops over the rolledIDs and adds missing IDs.
     * Why does this need to happen?
     * 
     * @param {Map} statMap - the stat map storing the rolledIDs
     */
    fillEmptyRolledIDs(statMap) {
        for (const id of rolledIDs) {
            if (statMap.get("minRolls").has(id)) {
                continue;
            }
            statMap.get("minRolls").set(id, 0);
            statMap.get("maxRolls").set(id, 0);
        }
    }

    /**
     * Clamps the durability, duration, and charges of the crafted item.
     * 
     * @param {Map} statMap the stat map to clamp the attributes of
     * @returns the stat map with the attributes clamped
     */
    clampAttributes(statMap) {

        // why is this in a for loop?
        // too afraid to change it tho
        // isn't there only every one durability?
        for (const d in statMap.get("durability")) {
            if (statMap.get("durability")[d] < 1) {
                statMap.get("durability")[d] = 1;
                continue;
            }
            statMap.get("durability")[d] = Math.floor(statMap.get("durability")[d]);
        }

        // same for loop thing here
        for (const d in statMap.get("duration")) {
            if (!this.isAllNone() && statMap.get("duration")[d] < 10) { statMap.get("duration")[d] = 10; }
        }

        if (statMap.has("charges") && statMap.get("charges") < 1) { statMap.set("charges", 1); }

        return statMap;
    }

    /**
     * Applies the powder ingredient to the item.
     * 
     * @pre Must check that the passed ingredient is a powder
     * @param {*} ingred - the powder ingredient being applied
     * @param {Map} statMap - the stat map to apply the powder ingredient to
     */
    applyPowderIngredient(ingred, statMap) {
        let powder = powderStats[ingred.get("pid")];
        let name = powderNames.get(ingred.get("pid"));
        statMap.set(name.charAt(0) + "Def", (statMap.get(name.charAt(0) + "Def") || 0) + powder["defPlus"]);
        statMap.set(skp_elements[(skp_elements.indexOf(name.charAt(0)) + 4) % 5] + "Def", (statMap.get(skp_elements[(skp_elements.indexOf(name.charAt(0)) + 4) % 5] + "Def") || 0) - powder["defMinus"]);
    }

    /**
     * Finds the attack speed ratio for this weapon.
     * 
     * @pre Any checks that this craft is a weapon should be done outside of this method.
     * @returns {number} the attack speed ratio of this craft
     */
    getAttackSpeedRatio() {
        let ratio = 2.05;
        if (this['atkSpd'] === "SLOW") {
            ratio /= 1.5;
        } else if (this['atkSpd'] === "NORMAL") {
            ratio = 1;
        } else if (this['atkSpd'] === "FAST") {
            ratio /= 2.5;
        }
        return ratio;
    }

    /**
     * Computes the material multiplier.
     * 
     * @returns {number} the material effect bonus multiplier from this
     */
    getMaterialMultiplier() {
        let matmult = 1;
        let tierToMult = [0, 1, 1.25, 1.4];
        let tiers = this.mat_tiers.slice();
        let amounts = this.recipe.get("materials").map(x => x.get("amount"));
        //Mat Multipliers - should work!
        matmult = (tierToMult[tiers[0]] * amounts[0] + tierToMult[tiers[1]] * amounts[1]) / (amounts[0] + amounts[1]);
        return matmult;
    }

    /**
     * Finds the ingredient effectiveness of all of the ingredients.
     * 
     * @returns {number[][]} the effectiveness of each ingredient
     */
    getIngredientEffectiveness() {

        // set baseline effectiveness
        let eff = [[100, 100], [100, 100], [100, 100]];

        // loop ingredients
        for (let n in this.ingreds) {

            let ingred = this.ingreds[n];
            // i and j will refer to the eff matrix.
            let i = Math.floor(n / 2);
            let j = n % 2;
            
            // loop over effectiveness modifications of ingredient
            for (const [key, value] of ingred.get("posMods")) {
                // if the modification is nothing, do nothing
                if (value == 0) {
                    continue;
                }
                eff = this.applyEffectivenessModification(key, i, j, eff, value);
            }
        }

        return eff;

    }

    /**
     * Applies the effectiveness modifications to the effectiveness modification array.
     *
     * @param {string} key - the key describing how the effectiveness modificaiton is applied
     * @param {*} i - the i index of the ingredient
     * @param {*} j - the j index of the ingredient
     * @param {*} eff - the effectiveness of the ingredient
     * @param {*} value - the effectiveness that the ingredient provides (15% = 15)
     * @returns {number[][]} the array of the updated effectivenesses
     */
    applyEffectivenessModification(key, i, j, eff, value) {

        // TODO: There HAS to be a better way of doing this without so goddamn many if statements
        // Consider keeping the key system, but applying a lambda function based on the key
        // Filter out locations that aren't valid with the lambda and apply += value on those that are
        // This would slow down the code, but not many computations are being made anyways
        // Additionally, this would make adding more functionality easier if wynncraft changes any modification innerworkings
        
        if (key === "above") {
            for (let k = i - 1; k > -1; k--) {
                eff[k][j] += value;
            }
            return eff;
        }
        if (key === "under") {
            for (let k = i + 1; k < 3; k++) {
                eff[k][j] += value;
            }
            return eff;
        }
        if (key === "left") {
            if (j == 1) {
                eff[i][j - 1] += value;
            }
            return eff;
        } 
        if (key === "right") {
            if (j == 0) {
                eff[i][j + 1] += value;
            }
            return eff;
        }
        if (key === "touching") {
            for (let k in eff) {
                for (let l in eff[k]) {
                    if ((Math.abs(k - i) == 1 && Math.abs(l - j) == 0) || (Math.abs(k - i) == 0 && Math.abs(l - j) == 1)) {
                        eff[k][l] += value;
                    }
                }
            }
            return eff;
        }
        if (key === "notTouching") {
            for (let k in eff) {
                for (let l in eff[k]) {
                    if ((Math.abs(k - i) > 1) || (Math.abs(k - i) == 1 && Math.abs(l - j) == 1)) {
                        eff[k][l] += value;
                    }
                }
            }
            return eff;
        }
        console.log("Something went wrong. Please contact hppeng.");
        return undefined;
    }

    /**
     * Creates a new stat map.
     * 
     * @returns {Map} a stat map with the default key-value pairs pre-set
     */
    initStatMap() {
        
        // create map
        let statMap = new Map();

        // set defaults
        statMap.set("crafted", true);
        statMap.set("minRolls", new Map());
        statMap.set("maxRolls", new Map());
        statMap.set("name", this.hash);
        statMap.set("displayName", this.hash);
        statMap.set("tier", "Crafted");
        statMap.set("type", this.recipe.get("type").toLowerCase());
        statMap.set("duration", [this.recipe.get("duration")[0], this.recipe.get("duration")[1]]); //[low, high]
        statMap.set("durability", [this.recipe.get("durability")[0], this.recipe.get("durability")[1]]); //[low, high]
        statMap.set("lvl", this.recipe.get("lvl")[1]);
        statMap.set("lvlLow", this.recipe.get("lvl")[0]);
        statMap.set("nDam", 0);
        statMap.set("hp", 0);
        statMap.set("hpLow", 0);
        statMap.set("powders",[]);
        statMap.set("reqs",[0,0,0,0,0]);
        statMap.set("skillpoints", [0,0,0,0,0]);

        // loop over elemental damages and set them to zero
        // same with defenses
        for (const e of skp_elements) {
            statMap.set(e + "Dam", "0-0");
            statMap.set(e + "Def", 0);
        }

        // set all stat requirements to nothing
        // set all item skillpoints to nothing
        for (const e of skp_order) {
            statMap.set(e + "Req", 0);
            statMap.set(e, 0);
        }

        // output
        return statMap;

    }

    /**
     * Determines the number of powder slots on the weapon/armor.
     * Returns 0 if the item is not a weapon or an armor.
     * 
     * @param {Map} statMap - the stat map to add the powder slots to
     * @returns {number} the number of powder slots on this weapon/armor
     */
    getPowderSlotCount(statMap) {

        if (!isArmor(statMap.get("type")) && !isWeapon(statMap.get("type"))) {
            return 0;
        }

        const secondSlotLevel = 30;
        const thirdSlotLevel = 70;

        if (this.recipe.get("lvl")[0] < secondSlotLevel) {
            return 1;
        }
        
        if (this.recipe.get("lvl")[0] < thirdSlotLevel) {
            return 2;
        } 
        
        return 3;

    }

    /**
     * Determines the number of consumable charges on the consumable.
     * Returns 0 if the item is not a consumable.
     * 
     * @param {Map} statMap - stat map to add the charges to
     * @returns {number} the number of consumable charges on this consumable
     */
    getConsumableCharges(statMap) {

        if (!isConsumable(statMap.get("type"))) {
            return 0;
        }

        const secondSlotLevel = 30;
        const thirdSlotLevel = 70;

        if (this.recipe.get("lvl")[0] < secondSlotLevel) {
            return 1;
        }
        
        if (this.recipe.get("lvl")[0] < thirdSlotLevel) {
            return 2;
        } 
        
        return 3;

    }

    /**
     * Determines if there are no ingredients in the craft.
     * 
     * @returns {boolean} whether or not there are no ingredients present
     */
    isAllNone() {
        for (const ingred of this.ingreds) {
            if (ingred.get("name") !== "No Ingredient") {
                return false;
            }
        }
        return true;
    }

    copy() {
        return new Craft(this.recipe, this.mat_tiers, this.ingreds, this.atkSpd, this.hash.slice(3));
    }
}

