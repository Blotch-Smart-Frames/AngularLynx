import cfonts from 'cfonts';
import pc from 'picocolors';

export const printBanner = (): void => {
  const rendered = cfonts.render('dolan', {
    font: 'block',
    colors: ['cyan', 'blue'],
    space: false,
  });

  if (rendered) {
    console.log(rendered.string);
  }
  console.log(pc.dim('  UI components for AngularLynx'));
  console.log();
};
