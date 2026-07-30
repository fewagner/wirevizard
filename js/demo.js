// demo.js — embedded sample data so the app can be tried with zero
// configuration (?demo=1). Entirely fictional.

export const DEMO_FILES = {
  'devices.csv': `name,description,role,x,y,comment
AWG-1,Arbitrary waveform generator,AWG,40,60,,ch1 out,ch2 out,trig in
Downconverter,RF downconversion box,downconverter,660,40,,"RF in (IF out)","IF out (RF in)",LO in
Patch panel A,Rack patch panel,patch panel,340,120,"Rack 3, second panel from the top.","A1 (A2)","A2 (A1)","A3 (A4)","A4 (A3)"
Digitizer,2-channel digitizer,digitizer,960,120,,in 1,in 2,clk in
Fridge line 1,Cryostat input line K1,fridge line,340,340,,"top (bottom)","bottom (top)"
LO source,Local oscillator,MWG,660,320,,RF out
Sample X,Demo two-qubit chip,Chip,40,340,,"qb1 drive [Charge line]","qb1 flux [Flux line]","qb2 drive [Charge line]"
`,
  'setups.csv': `name,description
Demo setup,Example measurement chain
Spare,Unused bench equipment
`,
  'cables.csv': `cable_id,from_device,from_port,to_device,to_port,setup,comment
C001,AWG-1,ch1 out,Patch panel A,A1,Demo setup,Replaced 2026-06-12 after a broken shield.
C002,Patch panel A,A2,Downconverter,RF in,Demo setup,
C003,Downconverter,IF out,Digitizer,in 1,Demo setup,
C004,LO source,RF out,Downconverter,LO in,Demo setup,
C005,AWG-1,ch2 out,Fridge line 1,top,Demo setup,
C006,Digitizer,in 2,Patch panel A,A3,Demo setup,
C007,Fridge line 1,bottom,Sample X,qb1 flux,Demo setup,
`,
};
