const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function updateGraphify() {
  console.log("\n==========================================");
  console.log("   UPDATING GRAPHIFY KNOWLEDGE GRAPH      ");
  console.log("==========================================\n");

  const projectRoot = path.resolve(__dirname, "..");
  let pythonCmd = "python";

  // Check saved python interpreter if exists
  const pythonPathFile = path.join(projectRoot, "graphify-out", ".graphify_python");
  if (fs.existsSync(pythonPathFile)) {
    const saved = fs.readFileSync(pythonPathFile, "utf8").trim();
    if (saved && fs.existsSync(saved)) {
      pythonCmd = `"${saved}"`;
    }
  }

  try {
    console.log("[1/2] Running incremental AST update on codebase...");
    try {
      execSync(`${pythonCmd} -m graphify update .`, {
        cwd: projectRoot,
        stdio: "inherit"
      });
    } catch (e) {
      console.log("Incremental update notice. Running full re-extraction...");
      execSync(`${pythonCmd} -m graphify extract . --code-only --force`, {
        cwd: projectRoot,
        stdio: "inherit"
      });
      execSync(`${pythonCmd} -m graphify cluster-only .`, {
        cwd: projectRoot,
        stdio: "inherit"
      });
    }

    console.log("\n[2/2] Exporting fresh interactive HTML graph visualization...");
    try {
      execSync(`${pythonCmd} -m graphify export html`, {
        cwd: projectRoot,
        stdio: "inherit"
      });
    } catch (err) {
      // Non-critical if export fails
    }

    // Read summary stats
    const graphJsonPath = path.join(projectRoot, "graphify-out", "graph.json");
    if (fs.existsSync(graphJsonPath)) {
      const data = JSON.parse(fs.readFileSync(graphJsonPath, "utf8"));
      const nodeCount = data.nodes ? data.nodes.length : 0;
      const edgeCount = (data.edges || data.links || []).length;

      console.log("\n------------------------------------------");
      console.log("  GRAPHIFY UPDATE COMPLETE!");
      console.log(`  Total Entities (Nodes): ${nodeCount}`);
      console.log(`  Relationships (Edges):  ${edgeCount}`);
      console.log("  Report:        graphify-out/GRAPH_REPORT.md");
      console.log("  Visualization: graphify-out/graph.html");
      console.log("------------------------------------------\n");
    }
  } catch (error) {
    console.error("\n[Error updating Graphify]:", error.message);
  }
}

updateGraphify();
