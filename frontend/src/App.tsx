import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DiagnosisList from './components/DiagnosisList';
import DiagnosisDetail from './components/DiagnosisDetail';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DiagnosisList />} />
        <Route path="/diagnoses/:id" element={<DiagnosisDetail />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
