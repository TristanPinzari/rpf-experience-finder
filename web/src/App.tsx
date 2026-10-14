import { NavLink, Route, Routes } from "react-router-dom";
import { CatalogPage } from "./pages/CatalogPage";
import { EvalPage } from "./pages/EvalPage";
import { ProjectPage } from "./pages/ProjectPage";
import { SearchPage } from "./pages/SearchPage";

export default function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            RFP Experience Finder <span className="synthetic">Prototype · synthetic data</span>
          </div>
          <nav>
            <NavLink to="/" end>
              Search
            </NavLink>
            <NavLink to="/catalog">Catalog</NavLink>
            <NavLink to="/evaluation">Evaluation</NavLink>
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/evaluation" element={<EvalPage />} />
          <Route path="*" element={<div className="page"><p>Page not found.</p></div>} />
        </Routes>
      </main>
    </>
  );
}
