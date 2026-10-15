import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',timeout:45000,fullyParallel:false,workers:1,
  use:{baseURL:'http://localhost:4183',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  reporter:[['list'],['html',{open:'never'}]],
  webServer:{command:process.env.STUDIO_TEST_PRODUCTION==='1'?'npm start':'npm run dev',url:'http://localhost:4183/api/health',reuseExistingServer:false,timeout:60000,env:{PORT:'4183',STUDIO_DATA_DIR:'artifacts/browser-data',STUDIO_ORIGIN:'http://localhost:4183'}}
});
