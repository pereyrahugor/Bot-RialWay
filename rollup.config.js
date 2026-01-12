import typescript from 'rollup-plugin-typescript2'

export default {
    input: ['src/app.ts', 'scripts/init_functions.ts'],
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: chunk => {
            if (chunk.facadeModuleId.includes('scripts')) {
                return 'scripts/[name].js';
            }
            return '[name].js';
        }
    },
    onwarn: (warning) => {
        if (warning.code === 'UNRESOLVED_IMPORT') return
    },
    plugins: [typescript()],
}
