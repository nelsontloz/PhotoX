const { Pool } = require("pg");

function createPool(databaseUrl) {
  return new Pool({ connectionString: databaseUrl });
}

module.exports = {
  createPool
};

