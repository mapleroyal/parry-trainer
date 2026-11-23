use build_parry_trainer_map::build_range_markers;
use std::{env, error::Error, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let directory = env::args_os().nth(1).ok_or("usage: range-markers <output-directory>")?;
    build_range_markers(&PathBuf::from(directory))
}
