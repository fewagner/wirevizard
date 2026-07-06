// demo.js — embedded sample data so the app can be tried with zero
// configuration (?demo=1). Entirely fictional.

export const DEMO_FILES = {
  'devices.csv': `name,description
AWG-1,Arbitrary waveform generator,ch1 out,ch2 out,trig in
Downconverter,RF downconversion box,"RF in (IF out)","IF out (RF in)",LO in
Patch panel A,Rack patch panel,"A1 (A2)","A2 (A1)","A3 (A4)","A4 (A3)"
Digitizer,2-channel digitizer,in 1,in 2,clk in
Fridge line 1,Cryostat input line K1,top,bottom
LO source,Local oscillator,RF out
`,
  'setups.csv': `name,description
Demo setup,Example measurement chain
Spare,Unused bench equipment
`,
  'cables.csv': `cable_id,from_device,from_port,to_device,to_port,setup,tag
C001,AWG-1,ch1 out,Patch panel A,A1,Demo setup,drive
C002,Patch panel A,A2,Downconverter,RF in,Demo setup,drive
C003,Downconverter,IF out,Digitizer,in 1,Demo setup,readout
C004,LO source,RF out,Downconverter,LO in,Demo setup,LO
C005,AWG-1,ch2 out,Fridge line 1,top,Demo setup,flux
C006,Digitizer,in 2,Patch panel A,A3,Demo setup,spare line — dead-ends at A4
`,
};
