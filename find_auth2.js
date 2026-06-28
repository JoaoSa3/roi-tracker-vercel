
try {
  // Try to import vercel's config store
  const conf = require("C:/Users/joaos/AppData/Roaming/npm/node_modules/vercel/node_modules/@vercel/cli/build/util/config/store.js");
  console.log("conf:", Object.keys(conf));
} catch(e) {
  console.log("Error loading conf:", e.message);
}

// Try @vercel/client config
try {
  const configStores = require("C:/Users/joaos/AppData/Roaming/npm/node_modules/vercel/dist");
  console.log("vercel dist exports:", Object.keys(configStores).slice(0, 20));
} catch(e) {
  console.log("Error loading vercel dist:", e.message.substring(0, 100));
}
