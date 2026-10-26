// Operator registry and WGSL uniform buffer auto-packer.
// Follows WGSL host-shareable data layout rules: explicit scalar/vector offsets,
// DataView binary writing (never Float32Array for integer fields), and 16-byte
// uniform struct size alignment.

const TYPE_INFO = {
    f32: { align: 4, size: 4, count: 1, base: "f32" },
    i32: { align: 4, size: 4, count: 1, base: "i32" },
    u32: { align: 4, size: 4, count: 1, base: "u32" },
    vec2f: { align: 8, size: 8, count: 2, base: "f32" },
    vec3f: { align: 16, size: 12, count: 3, base: "f32" },
    vec4f: { align: 16, size: 16, count: 4, base: "f32" },
};

export function roundUp(alignment, value) {
    return Math.ceil(value / alignment) * alignment;
}

/**
 * Computes exact byte offsets and 16-byte aligned buffer size for a WGSL uniform struct.
 * @param {Array<{key: string, type: string}>} uniformLayout
 */
export function computeUniformSchema(uniformLayout = []) {
    const fields = [];
    let offset = 0;
    let maxAlign = 4;

    for (const item of uniformLayout) {
        const info = TYPE_INFO[item.type];
        if (!info) {
            throw new Error(`Unsupported WGSL uniform type "${item.type}" for key "${item.key}"`);
        }
        offset = roundUp(info.align, offset);
        maxAlign = Math.max(maxAlign, info.align);
        fields.push({
            key: item.key,
            type: item.type,
            offset,
            size: info.size,
            align: info.align,
            count: info.count,
            base: info.base,
        });
        offset += info.size;
    }

    const structAlign = Math.max(16, maxAlign);
    const byteLength = Math.max(16, roundUp(structAlign, offset));

    return {
        fields,
        dataBytes: offset,
        byteLength,
    };
}

/**
 * Packs a JS parameter object into an ArrayBuffer matching the WGSL uniform schema.
 * @param {{fields: Array, byteLength: number}} schema
 * @param {Record<string, any>} params
 * @returns {ArrayBuffer}
 */
export function packUniforms(schema, params = {}) {
    const buffer = new ArrayBuffer(schema.byteLength);
    const view = new DataView(buffer);

    for (const field of schema.fields) {
        const raw = params[field.key];
        if (field.count === 1) {
            const val = raw !== undefined ? Number(raw) : 0;
            if (field.base === "f32") {
                view.setFloat32(field.offset, val, true);
            } else if (field.base === "i32") {
                view.setInt32(field.offset, Math.trunc(val), true);
            } else if (field.base === "u32") {
                view.setUint32(field.offset, Math.trunc(val) >>> 0, true);
            }
        } else {
            const arr = Array.isArray(raw) ? raw : [0, 0, 0, 0];
            for (let i = 0; i < field.count; i++) {
                const v = Number(arr[i] ?? 0);
                view.setFloat32(field.offset + i * 4, v, true);
            }
        }
    }

    return buffer;
}

/**
 * Extracts default parameter key-value map from an operator's paramSchema.
 * @param {Array<{key: string, default: number}>} paramSchema
 */
export function extractDefaultParams(paramSchema = []) {
    const defaults = {};
    for (const p of paramSchema) {
        defaults[p.key] = p.default;
    }
    return defaults;
}

export class OperatorRegistry {
    constructor() {
        this.operators = new Map();
    }

    register(descriptor) {
        if (!descriptor?.id) {
            throw new Error("Operator descriptor must have an 'id'");
        }
        const schema = computeUniformSchema(descriptor.uniformLayout || []);
        const defaults = extractDefaultParams(descriptor.paramSchema || []);
        const enriched = {
            pingPong: false,
            auxPingPong: false,
            category: "shaper",
            paramSchema: [],
            uniformLayout: [],
            ...descriptor,
            uniformSchema: schema,
            defaultParams: defaults,
        };
        this.operators.set(enriched.id, enriched);
        return enriched;
    }

    get(id) {
        return this.operators.get(id) || null;
    }

    has(id) {
        return this.operators.has(id);
    }

    listByCategory(category) {
        const result = [];
        for (const op of this.operators.values()) {
            if (!category || op.category === category) {
                result.push(op);
            }
        }
        return result;
    }

    listAll() {
        return Array.from(this.operators.values());
    }
}
