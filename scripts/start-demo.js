// Starts the server in Academic Evaluation DEMO_MODE (synthetic demo accounts + non-destructive tamper demo)
process.env.DEMO_MODE = 'true';
require('../server');
