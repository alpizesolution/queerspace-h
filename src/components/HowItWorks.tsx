import React from 'react';
import { MousePointerClick, Heart, MessageCircleHeart } from 'lucide-react';

export const HowItWorks: React.FC = () => {
  const steps = [
    {
      number: '01',
      icon: MousePointerClick,
      title: 'Choose how you want to connect',
      description:
        'Jump straight into an instant 1-on-1 chat, tailor a match with your favorite topics, or pull up a chair in the public room.',
    },
    {
      number: '02',
      icon: Heart,
      title: 'Set optional preferences',
      description:
        'Everything is completely optional. Pick a cozy pseudonym, share your pronouns or intentions, or leave them blank.',
    },
    {
      number: '03',
      icon: MessageCircleHeart,
      title: 'Start a genuine conversation',
      description:
        'Talk freely in a safe, moderated sapphic atmosphere. Leave or skip with one click whenever you want.',
    },
  ];

  return (
    <section className="py-12 bg-[#150826]/60 border-y border-[#4a1f6d]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-[#e07bb8] bg-[#230d3b] px-3 py-1 rounded-full border border-[#4a1f6d]">
            Simple & Transparent
          </span>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#fcf7fa] mt-3">
            How QUEERSPACE Works
          </h2>
          <p className="text-sm sm:text-base text-[#cbbccf] mt-1 max-w-lg mx-auto">
            No friction, no algorithms judging you, no paywalls. Just a straightforward path to talking with other women.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div
                key={step.number}
                className="relative glass-card glass-card-hover rounded-3xl p-6 flex flex-col justify-between shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <span className="font-serif text-3xl font-semibold text-[#e07bb8]/40">
                      {step.number}
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-[#230d3b] text-[#e07bb8] flex items-center justify-center border border-[#4a1f6d]">
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                  <h3 className="font-bold text-lg text-[#fcf7fa] mb-2 leading-snug">
                    {step.title}
                  </h3>
                  <p className="text-sm text-[#cbbccf] leading-relaxed">
                    {step.description}
                  </p>
                </div>

                {idx < steps.length - 1 && (
                  <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-[#230d3b] border border-[#4a1f6d] text-[#e07bb8] text-center leading-5 text-xs font-bold shadow-sm">
                    →
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
