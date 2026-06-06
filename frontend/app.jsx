/* global React, ReactDOM, window */
const { Hero, TheGap, Modules, TheLoop, TheProof, Repo, Footer, TryIt } = window;

function App() {
  return (
    <React.Fragment>
      <Hero />
      <TheGap />
      <Modules />
      <TheLoop />
      <TryIt />
      <TheProof />
      <Repo />
      <Footer />
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
