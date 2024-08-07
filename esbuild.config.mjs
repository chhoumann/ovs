import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import copy from "esbuild-plugin-copy";

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = process.argv[2] === "production";
const outdir = "./out";

const options = Object.freeze({
	banner: {
		js: banner,
	},
	entryPoints: ["src/main.ts"],
	bundle: true,
	define: {
		__IS_DEV__: (!prod).toString(),
	},
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outdir,
	plugins: [
		copy({
			assets: [
				{
					from: ["manifest.json"],
					to: ["manifest.json"],
				},
				{
					from: ["src/styles.css"],
					to: ["styles.css"]
				}
			],
		}),
	],
});

if (!prod) {
	const context = await esbuild.context(options);
	await context.watch();
} else {
	await esbuild.build(options).catch(() => process.exit(1));
}
