import type { ForgeConfig } from "@electron-forge/shared-types";
import path from "node:path";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const pageAdapter = path.resolve(
  process.cwd(),
  "adapters",
  "leetcode-cn.cjs"
);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "algo-companion",
    extraResource: [
      "LICENSE",
      "DISCLAIMER.md",
      "THIRD_PARTY_NOTICES.md",
      pageAdapter
    ]
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "algo_companion",
      authors: "Algo Companion contributors",
      description: "Local card-based algorithm practice companion"
    }),
    new MakerZIP({}, ["darwin", "win32"]),
    new MakerDeb({
      options: {
        name: "algo-companion",
        productName: "Algo Companion",
        genericName: "Education",
        categories: ["Education", "Development"],
        maintainer: "Algo Companion contributors"
      }
    }),
    {
      name: "@reforged/maker-appimage",
      config: {
        options: {
          categories: ["Education", "Development"],
          icon: "assets/icon.svg"
        }
      }
    }
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main"
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts"
        }
      ]
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
